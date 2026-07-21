import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { formatCluster } from "../../../common/atlas/cluster.js";
import type { ApiClient } from "../../../common/atlas/apiClient.js";
import { ApiClientError } from "../../../common/atlas/apiClientError.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";
import type { ScaleClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Standard M-series tiers this tool can scale to, capped at M80 (same cap as atlas-create-cluster).
const SELECTABLE_TIERS = ["M10", "M20", "M30", "M40", "M50", "M60", "M80"] as const;
const instanceSizeEnum = z.enum(SELECTABLE_TIERS);
type InstanceSize = z.infer<typeof instanceSizeEnum>;

// Full ordered list of standard tiers (including tiers above the M80 cap) used only to rank autoscaling maxes.
const STANDARD_TIER_ORDER = ["M10", "M20", "M30", "M40", "M50", "M60", "M80", "M100", "M140", "M200", "M300"];

// A plain standard M-series size, e.g. "M30". Variants (M40_NVME, M30_GEN_2, R40, ...) are unsupported.
const STANDARD_MSERIES_REGEX = /^M\d+$/;

function twoTiersAbove(size: InstanceSize): InstanceSize {
    const idx = SELECTABLE_TIERS.indexOf(size);
    return SELECTABLE_TIERS[Math.min(idx + 2, SELECTABLE_TIERS.length - 1)] ?? "M80";
}

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

type ResolvedClusterState = {
    instanceType: "FREE" | "FLEX" | "DEDICATED";
    raw?: ClusterDescription20240805;
    instanceSize?: string;
    currentMax?: string;
};

async function resolveClusterState(
    apiClient: Pick<ApiClient, "getCluster" | "getFlexCluster">,
    projectId: string,
    clusterName: string,
    context: ToolExecutionContext
): Promise<ResolvedClusterState> {
    try {
        const raw = await apiClient.getCluster({ params: { path: { groupId: projectId, clusterName } } }, context);
        const cluster = formatCluster(raw);
        const firstRegionConfig = raw.replicationSpecs?.[0]?.regionConfigs?.[0] as
            | { autoScaling?: { compute?: { maxInstanceSize?: string } } }
            | undefined;
        return {
            instanceType: cluster.instanceType,
            raw,
            instanceSize: cluster.instanceSize,
            currentMax: firstRegionConfig?.autoScaling?.compute?.maxInstanceSize,
        };
    } catch (err) {
        // Atlas returns 400 for Flex clusters on the dedicated Cluster API ("cannot be used in the Cluster API")
        // and 404 when the cluster doesn't exist. Both signal "try the flex endpoint".
        if (!(err instanceof ApiClientError) || (err.response.status !== 404 && err.response.status !== 400)) {
            throw err;
        }
        try {
            await apiClient.getFlexCluster({ params: { path: { groupId: projectId, name: clusterName } } }, context);
        } catch {
            throw err;
        }
        return { instanceType: "FLEX" };
    }
}

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

        const state = await resolveClusterState(this.apiClient, projectId, clusterName, context);

        if (state.instanceType !== "DEDICATED") {
            throw new ScaleClusterError(
                `Cluster "${clusterName}" is a ${state.instanceType} cluster. Scaling instance size only applies to dedicated (M10+) clusters. ` +
                    `Use the atlas-upgrade-cluster tool to move a Free or Flex cluster to a dedicated tier.`
            );
        }

        const currentSize = state.instanceSize;
        if (currentSize === undefined || !STANDARD_MSERIES_REGEX.test(currentSize)) {
            throw new ScaleClusterError(
                `Cluster "${clusterName}" uses the "${currentSize ?? "unknown"}" instance size. ` +
                    `atlas-scale-cluster only supports standard M-series tiers; high-memory, NVMe, Gen2, and low-CPU (R-series) variants are not supported.`
            );
        }
        if (!SELECTABLE_TIERS.includes(currentSize as InstanceSize)) {
            throw new ScaleClusterError(
                `Cluster "${clusterName}" is currently ${currentSize}, which is above the M80 cap this tool supports. ` +
                    `Use the Atlas CLI (\`atlas clusters update\`) or the Atlas UI to scale clusters larger than M80.`
            );
        }

        this.validateExplicitBounds(args);

        const compute = this.resolveComputeAutoScaling(args, currentSize as InstanceSize, state.currentMax);
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

    // Rejects incoherent autoscaling bounds supplied by the caller before anything is sent to Atlas.
    private validateExplicitBounds(args: ToolArgs<typeof this.argsShape>): void {
        const rank = (size: string): number => STANDARD_TIER_ORDER.indexOf(size);
        const { instanceSize, minInstanceSize, maxInstanceSize } = args;

        if (
            minInstanceSize !== undefined &&
            maxInstanceSize !== undefined &&
            rank(minInstanceSize) > rank(maxInstanceSize)
        ) {
            throw new ScaleClusterError(
                `minInstanceSize (${minInstanceSize}) cannot be larger than maxInstanceSize (${maxInstanceSize}).`
            );
        }
        if (instanceSize !== undefined && minInstanceSize !== undefined && rank(instanceSize) < rank(minInstanceSize)) {
            throw new ScaleClusterError(
                `instanceSize (${instanceSize}) cannot be smaller than minInstanceSize (${minInstanceSize}).`
            );
        }
        if (instanceSize !== undefined && maxInstanceSize !== undefined && rank(instanceSize) > rank(maxInstanceSize)) {
            throw new ScaleClusterError(
                `instanceSize (${instanceSize}) cannot be larger than maxInstanceSize (${maxInstanceSize}).`
            );
        }
    }

    private resolveComputeAutoScaling(
        args: ToolArgs<typeof this.argsShape>,
        currentSize: InstanceSize,
        currentMax: string | undefined
    ): ComputeAutoScaling {
        const explicitAutoScaling =
            args.computeAutoScaling !== undefined ||
            args.minInstanceSize !== undefined ||
            args.maxInstanceSize !== undefined;

        if (args.instanceSize !== undefined && !explicitAutoScaling) {
            const min = args.instanceSize;
            return {
                enabled: true,
                scaleDownEnabled: true,
                minInstanceSize: min,
                maxInstanceSize: preserveHigherMax(twoTiersAbove(min), currentMax),
            };
        }

        const enabled = args.computeAutoScaling ?? true;
        if (!enabled) {
            return { enabled: false, scaleDownEnabled: false };
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
