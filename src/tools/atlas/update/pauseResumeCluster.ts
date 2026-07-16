import { z } from "zod";
import { type OperationType, type ToolArgs, type ToolResult, type ToolExecutionContext } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";
import type { PauseResumeClusterMetadata } from "../../../telemetry/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";

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
    disconnectedConnectionIds: z
        .array(z.string())
        .describe("Connection IDs that were disconnected due to the cluster being paused."),
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
        let disconnectedConnectionIds: string[] = [];

        if (isPause) {
            text =
                `Cluster "${clusterName}" in project "${projectId}" is being paused. ` +
                `Paused clusters are unavailable for connections and do not incur compute costs.`;

            // Revoke any connections established to the cluster being paused.
            const affected = await this.session.connectionRegistry.find(
                (entry) =>
                    entry.state.connectedAtlasCluster?.projectId === projectId &&
                    entry.state.connectedAtlasCluster?.clusterName === clusterName
            );
            for (const entry of affected) {
                await this.session.connectionRegistry.disconnect(entry.connectionId);
            }
            disconnectedConnectionIds = affected.map((entry) => entry.connectionId);
            if (disconnectedConnectionIds.length > 0) {
                text += ` The following connections to cluster "${clusterName}" were disconnected and their connectionIds are no longer valid: ${disconnectedConnectionIds
                    .map((connectionId) => `"${connectionId}"`)
                    .join(", ")}.`;
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
                disconnectedConnectionIds,
            },
        };
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        context: { result: CallToolResult }
    ): Promise<PauseResumeClusterMetadata> {
        const parentMetadata = await super.resolveTelemetryMetadata(args, context);
        type Output = z.infer<z.ZodObject<typeof PauseResumeClusterOutputSchema>>;
        const sc = context.result.structuredContent as Output | undefined;
        return {
            ...parentMetadata,
            cluster_id: sc?.clusterId,
            action: sc?.action,
        };
    }
}
