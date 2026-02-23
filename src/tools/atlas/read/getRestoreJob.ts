import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs, CommonArgs } from "../../args.js";

export const GetRestoreJobArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
    restoreJobId: CommonArgs.objectId("restoreJobId").describe("Restore job ID"),
};

export class GetRestoreJobTool extends AtlasToolBase {
    static toolName = "atlas-get-restore-job";
    public description = "Get status details for an Atlas restore job";
    static operationType: OperationType = "read";
    public argsShape = {
        ...GetRestoreJobArgs,
    };

    protected async execute({
        projectId,
        clusterName,
        restoreJobId,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const restoreJob = await this.apiClient.getBackupRestoreJob({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                    restoreJobId,
                },
            },
        });

        const response = {
            restoreJobId: restoreJob.id ?? restoreJobId,
            deliveryType: restoreJob.deliveryType,
            snapshotId: restoreJob.snapshotId ?? "N/A",
            targetProjectId: restoreJob.targetGroupId ?? "N/A",
            targetClusterName: restoreJob.targetClusterName ?? "N/A",
            failed: restoreJob.failed ?? false,
            cancelled: restoreJob.cancelled ?? false,
            createdAt: restoreJob.timestamp ? new Date(restoreJob.timestamp).toISOString() : null,
            finishedAt: restoreJob.finishedAt ? new Date(restoreJob.finishedAt).toISOString() : null,
            expiresAt: restoreJob.expiresAt ? new Date(restoreJob.expiresAt).toISOString() : null,
            completionState: restoreJob.failed
                ? "failed"
                : restoreJob.cancelled
                  ? "cancelled"
                  : restoreJob.finishedAt
                    ? "completed"
                    : "inProgress",
        };

        return {
            content: formatUntrustedData(
                `Restore job "${restoreJobId}" for cluster "${clusterName}" in project ${projectId}`,
                JSON.stringify(response)
            ),
        };
    }
}
