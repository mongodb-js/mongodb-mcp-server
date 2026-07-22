import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { resolveClusterInfo } from "../../../common/atlas/cluster.js";
import {
    standardInstanceSizeEnum as instanceSizeEnum,
    twoStandardTiersAbove as twoTiersAbove,
    type StandardInstanceSize as InstanceSize,
} from "../../../common/atlas/instanceSizes.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import type { ScaleClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Full ordered list of standard tiers (including tiers above the M80 cap) used only to rank autoscaling maxes.
const STANDARD_TIER_ORDER = ["M10", "M20", "M30", "M40", "M50", "M60", "M80", "M100", "M140", "M200", "M300"];

// A plain standard M-series size, e.g. "M30". Variants (M40_NVME, M30_GEN_2, R40, ...) are unsupported.
const STANDARD_MSERIES_REGEX = /^M\d+$/;

function preserveHigherMax(computed: InstanceSize, currentMax: string | undefined): string {
    if (currentMax === undefined) {
        return computed;
    }
    const currentIdx = STANDARD_TIER_ORDER.indexOf(currentMax);
    const computedIdx = STANDARD_TIER_ORDER.indexOf(computed);
    return currentIdx > computedIdx ? currentMax : computed;
}

type ComputeAutoScaling = {
    enabled: boolean;
    scaleDownEnabled: boolean;
    minInstanceSize?: string;
    maxInstanceSize?: string;
};

class ScaleClusterError extends Error {}

export const ScaleClusterOutputSchema = {
    clusterName: z.string(),
    instanceSize: z.string(),
    computeAutoScaling: z.boolean(),
    minInstanceSize: z.string().optional(),
    maxInstanceSize: z.string().optional(),
    clusterId: z.string().optional(),
};

export class ScaleClusterTool extends AtlasToolBase {
    static toolName = "atlas-scale-cluster";
    public description =
        "Scale a dedicated (M10+) MongoDB Atlas cluster by changing its instance size and/or compute autoscaling bounds (electable and read-only nodes only; analytics nodes are not scaled). " +
        "Supports standard M-series tiers up to M80; for larger sizes use the Atlas CLI (`atlas clusters update`) or UI. " +
        "This tool does NOT change cluster tiers: to move a Free (M0) or Flex cluster to a dedicated tier, use the atlas-upgrade-cluster tool instead. " +
        "Returns immediately; poll readiness (state: IDLE) with atlas-inspect-cluster. " +
        "Note to LLM: provide at least one of instanceSize, computeAutoScaling, minInstanceSize, or maxInstanceSize.";
    static operationType: OperationType = "update";
    public override outputSchema = ScaleClusterOutputSchema;
    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to scale"),
        instanceSize: instanceSizeEnum
            .optional()
            .describe(
                "Target standard M-series instance size (M10–M80). Omit to keep the current size and only adjust autoscaling bounds."
            ),
        computeAutoScaling: z
            .boolean()
            .optional()
            .describe(
                "Explicitly enable (true) or disable (false) compute autoscaling. If omitted and an instanceSize is provided, autoscaling is reconciled automatically."
            ),
        minInstanceSize: instanceSizeEnum
            .optional()
            .describe("Minimum standard M-series instance size (M10–M80) for compute autoscaling."),
        maxInstanceSize: instanceSizeEnum
            .optional()
            .describe("Maximum standard M-series instance size (M10–M80) for compute autoscaling."),
    };

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const { projectId, clusterName } = args;

        if (
            args.instanceSize === undefined &&
            args.computeAutoScaling === undefined &&
            args.minInstanceSize === undefined &&
            args.maxInstanceSize === undefined
        ) {
            throw new ScaleClusterError(
                "At least one of instanceSize, computeAutoScaling, minInstanceSize, or maxInstanceSize must be provided."
            );
        }

        const state = await resolveClusterInfo(this.apiClient, projectId, clusterName, context);

        if (state.instanceType !== "DEDICATED") {
            throw new ScaleClusterError(
                `Cluster "${clusterName}" is a ${state.instanceType} cluster. Scaling instance size only applies to dedicated (M10+) clusters. ` +
                    `Use the atlas-upgrade-cluster tool to move a Free or Flex cluster to a dedicated tier.`
            );
        }

        const currentSize = state.cluster?.instanceSize;
        if (currentSize === undefined || !STANDARD_MSERIES_REGEX.test(currentSize)) {
            throw new ScaleClusterError(
                `Cluster "${clusterName}" uses the "${currentSize ?? "unknown"}" instance size. ` +
                    `atlas-scale-cluster only supports standard M-series tiers; high-memory, NVMe, Gen2, and low-CPU (R-series) variants are not supported.`
            );
        }

        const currentCompute = state.raw?.replicationSpecs?.[0]?.regionConfigs?.[0] as
            | { autoScaling?: { compute?: { enabled?: boolean; maxInstanceSize?: string } } }
            | undefined;
        const compute = this.resolveComputeAutoScaling(
            args,
            currentSize as InstanceSize,
            currentCompute?.autoScaling?.compute?.maxInstanceSize,
            currentCompute?.autoScaling?.compute?.enabled
        );
        const targetSize = args.instanceSize ?? currentSize;

        const body = this.buildUpdateBody(state.raw, targetSize, compute);

        const result = await this.apiClient.updateCluster(
            {
                params: { path: { groupId: projectId, clusterName } },
                body,
            } as unknown as Parameters<typeof this.apiClient.updateCluster>[0],
            context
        );

        return {
            content: [
                {
                    type: "text",
                    text:
                        `Cluster "${clusterName}" in project "${projectId}" is being scaled to ${targetSize}` +
                        `${compute.enabled ? ` (compute autoscaling ${compute.minInstanceSize}–${compute.maxInstanceSize})` : " (compute autoscaling disabled)"}. ` +
                        `Use the atlas-inspect-cluster tool with projectId "${projectId}" and clusterName "${clusterName}" to poll for readiness. ` +
                        `The cluster is ready when its state is IDLE.`,
                },
            ],
            structuredContent: {
                clusterName,
                instanceSize: targetSize,
                computeAutoScaling: compute.enabled,
                minInstanceSize: compute.minInstanceSize,
                maxInstanceSize: compute.maxInstanceSize,
                clusterId: result?.id,
            },
        };
    }

    private resolveComputeAutoScaling(
        args: ToolArgs<typeof this.argsShape>,
        currentSize: InstanceSize,
        currentMax: string | undefined,
        currentEnabled: boolean | undefined
    ): ComputeAutoScaling {
        const explicitBounds = args.minInstanceSize !== undefined || args.maxInstanceSize !== undefined;

        // Preserve the cluster's current autoscaling state unless the caller sets it explicitly.
        // Supplying explicit bounds implies intent to autoscale, so it enables autoscaling.
        const enabled = args.computeAutoScaling ?? (explicitBounds ? true : (currentEnabled ?? false));
        if (!enabled) {
            return { enabled: false, scaleDownEnabled: false };
        }

        // Size-only change on an autoscaling-enabled cluster: reconcile bounds around the new size.
        if (args.instanceSize !== undefined && args.computeAutoScaling === undefined && !explicitBounds) {
            const min = args.instanceSize;
            return {
                enabled: true,
                scaleDownEnabled: true,
                minInstanceSize: min,
                maxInstanceSize: preserveHigherMax(twoTiersAbove(min), currentMax),
            };
        }

        const min = args.minInstanceSize ?? args.instanceSize ?? currentSize;
        const max = args.maxInstanceSize ?? preserveHigherMax(twoTiersAbove(min), currentMax);
        return {
            enabled: true,
            scaleDownEnabled: true,
            minInstanceSize: min,
            maxInstanceSize: max,
        };
    }

    // Rebuilds replicationSpecs so PATCH preserves topology, applying the new size/autoscaling to
    // electable and read-only nodes only. Analytics nodes (analyticsSpecs/analyticsAutoScaling) are
    // left untouched — this tool does not scale them.
    private buildUpdateBody(
        raw: ClusterDescription20240805 | undefined,
        targetSize: string,
        compute: ComputeAutoScaling
    ): ClusterDescription20240805 {
        const replicationSpecs = (raw?.replicationSpecs ?? []).map((spec) => {
            const regionConfigs = ((spec.regionConfigs ?? []) as Array<Record<string, unknown>>).map((rc) => {
                const electableSpecs = rc.electableSpecs as Record<string, unknown> | undefined;
                const readOnlySpecs = rc.readOnlySpecs as Record<string, unknown> | undefined;
                const existingAutoScaling = rc.autoScaling as { diskGB?: unknown } | undefined;
                // Regions with no electable/read-only nodes (e.g. analytics-only) don't take compute
                // autoscaling, so leave their config untouched rather than injecting an autoScaling block.
                if (!electableSpecs && !readOnlySpecs) {
                    return { ...rc };
                }
                return {
                    ...rc,
                    ...(electableSpecs && { electableSpecs: { ...electableSpecs, instanceSize: targetSize } }),
                    ...(readOnlySpecs && { readOnlySpecs: { ...readOnlySpecs, instanceSize: targetSize } }),
                    autoScaling: { compute: { ...compute }, diskGB: existingAutoScaling?.diskGB ?? { enabled: true } },
                };
            });
            return { ...spec, regionConfigs };
        });

        return { replicationSpecs } as unknown as ClusterDescription20240805;
    }

    protected override handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): CallToolResult {
        if (error instanceof ScaleClusterError) {
            return {
                content: [{ type: "text", text: error.message }],
                isError: true,
            };
        }
        return super.handleError(error, args) as CallToolResult;
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): Promise<ScaleClusterMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        type ScaleClusterOutput = z.infer<z.ZodObject<typeof ScaleClusterOutputSchema>>;
        const sc = context.result.structuredContent as ScaleClusterOutput | undefined;

        return {
            ...parentMetadata,
            cluster_id: sc?.clusterId,
            instance_size: sc?.instanceSize,
            compute_auto_scaling: sc !== undefined ? (sc.computeAutoScaling ? "true" : "false") : undefined,
            min_instance_size: sc?.minInstanceSize,
            max_instance_size: sc?.maxInstanceSize,
        };
    }
}
