import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";
import type { ScaleClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Dedicated instance sizes that a paid cluster can be scaled between.
// M0 (Free) and Flex are intentionally excluded: moving up from those tiers is a
// tier *upgrade* and is handled by the atlas-upgrade-cluster tool, not this one.
const DEDICATED_INSTANCE_SIZES = ["M10", "M20", "M30", "M40", "M50", "M60", "M80", "M140", "M200", "M300"] as const;

export const ScaleClusterOutputSchema = {
    clusterName: z.string(),
    targetInstanceSize: z.enum(DEDICATED_INSTANCE_SIZES),
    clusterId: z.string().optional(),
};

/**
 * SCAFFOLD ONLY.
 *
 * This tool defines the description, input schema and a hardcoded response so we can
 * evaluate tool-selection accuracy (does an LLM route "scale my cluster" here vs.
 * atlas-upgrade-cluster?). It intentionally contains NO Atlas API logic yet — see
 * the scale-vs-upgrade recommendation doc for the plan to wire this up.
 */
export class ScaleClusterTool extends AtlasToolBase {
    static toolName = "atlas-scale-cluster";
    public description = `Scale a dedicated (paid, M10 or higher) MongoDB Atlas cluster to a different dedicated instance size, either up (e.g. M10 → M30) or down (e.g. M40 → M20). Use this ONLY for clusters that are already at a dedicated tier (M10+). DO NOT use this tool for Free (M0) or Flex clusters — moving those to a higher tier is a tier upgrade; use the atlas-upgrade-cluster tool instead.`;
    static operationType: OperationType = "update";
    public override outputSchema = ScaleClusterOutputSchema;
    public argsShape = {
        projectId: AtlasArgs.projectId()
            .optional()
            .describe("Atlas project ID. Required if not connected to a cluster."),
        clusterName: AtlasArgs.clusterName()
            .optional()
            .describe("Name of the dedicated cluster to scale. Required if not connected to a cluster."),
        targetInstanceSize: z
            .enum(DEDICATED_INSTANCE_SIZES)
            .describe("Target dedicated instance size to scale to (e.g. M10, M30). Must be a dedicated (M10+) size."),
    };

    // eslint-disable-next-line @typescript-eslint/require-await
    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        _context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const projectId = args.projectId ?? this.session.connectedAtlasCluster?.projectId;
        const clusterName = args.clusterName ?? this.session.connectedAtlasCluster?.clusterName;

        if (!projectId || !clusterName) {
            throw new Error("projectId and clusterName are required when not connected to a cluster.");
        }

        // TODO(MCP): replace this hardcoded response with a real Atlas cluster-update call
        // (updateCluster with the new electableSpecs/analyticsSpecs instance size).
        return {
            content: [
                {
                    type: "text",
                    text: `[scaffold] Cluster "${clusterName}" would be scaled to ${args.targetInstanceSize}. This tool is not yet wired up to the Atlas API.`,
                },
            ],
            structuredContent: {
                clusterName,
                targetInstanceSize: args.targetInstanceSize,
                clusterId: undefined,
            },
        };
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): ScaleClusterMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, context);
        type ScaleClusterOutput = z.infer<z.ZodObject<typeof ScaleClusterOutputSchema>>;
        const sc = context.result.structuredContent as ScaleClusterOutput | undefined;

        return {
            ...parentMetadata,
            target_instance_size: sc?.targetInstanceSize,
            cluster_id: sc?.clusterId,
        };
    }
}
