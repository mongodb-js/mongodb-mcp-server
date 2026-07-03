import { z } from "zod";
import { type ToolArgs, type ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType, ToolExecutionContext, CallToolResult } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import { AtlasArgs } from "../../args.js";
import type { PauseResumeClusterMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import type { ClusterDescription20240805 } from "@mongodb-js/mcp-atlas-api-client";

/** @public */
export const ATLAS_PAUSE_RESUME_CLUSTER_README_DESCRIPTION =
    "Pause or resume a dedicated (M10+) MongoDB Atlas cluster.";

const actionEnum = z.enum(["PAUSE", "RESUME"]);

export const PauseResumeClusterArgsShape = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID the cluster belongs to."),
    clusterName: AtlasArgs.clusterName().describe("Name of the cluster to pause or resume."),
    action: actionEnum.describe("Action to perform on the cluster."),
};

export const PauseResumeClusterOutputSchema = {
    clusterName: z.string(),
    action: actionEnum,
    clusterId: z.string().optional(),
    disconnected: z.boolean(),
};

export class PauseResumeClusterTool extends AtlasToolBase {
    static toolName = "atlas-pause-resume-cluster";
    static operationType: OperationType = "update";

    public description =
        "Pause or resume a dedicated (M10+) MongoDB Atlas cluster (Free and Flex clusters cannot be paused). " +
        "Pause: paused clusters are unavailable for connections and do not incur compute costs. " +
        "If the cluster being paused is the current active connection, it will be automatically disconnected. " +
        "Returns an error if the cluster is already paused or not in a pausable state (must be IDLE). " +
        "Resume: the cluster will not be immediately available after resuming. " +
        "Use the atlas-inspect-cluster tool to poll the cluster state for readiness (state: IDLE). " +
        "If the cluster is not paused, resuming it is a no-op.";

    public override outputSchema = PauseResumeClusterOutputSchema;

    public argsShape = PauseResumeClusterArgsShape;

    protected async execute(
        args: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const { projectId, clusterName, action } = args;
        const isPause = action === "PAUSE";

        const result = await this.apiClient.updateCluster(
            {
                params: { path: { groupId: projectId, clusterName } },
                body: { paused: isPause } as unknown as ClusterDescription20240805,
            },
            context
        );

        let text: string;
        let disconnected = false;

        if (isPause) {
            text =
                `Cluster "${clusterName}" in project "${projectId}" is being paused. ` +
                `Paused clusters are unavailable for connections and do not incur compute costs.`;

            // Disconnect if the cluster being paused is the one with the active connection.
            const connection = this.session.connectedAtlasCluster;
            if (connection?.projectId === projectId && connection?.clusterName === clusterName) {
                await this.session.disconnect();
                text += ` The connection to cluster "${clusterName}" is now disconnected.`;
                disconnected = true;
            }
        } else {
            text =
                `Cluster "${clusterName}" in project "${projectId}" is being resumed. ` +
                `Use the atlas-inspect-cluster tool with projectId "${projectId}" and clusterName "${clusterName}" to poll for readiness. ` +
                `The cluster is ready when its state is IDLE.`;
        }

        return {
            content: [{ type: "text", text }],
            structuredContent: {
                clusterName,
                action,
                clusterId: result.id,
                disconnected,
            },
        };
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): PauseResumeClusterMetadata {
        const parentMetadata = super.resolveTelemetryMetadata(args, context);
        type Output = z.infer<z.ZodObject<typeof PauseResumeClusterOutputSchema>>;
        const sc = context.result.structuredContent as Output | undefined;
        return {
            ...parentMetadata,
            cluster_id: sc?.clusterId,
            action: sc?.action,
        };
    }
}
