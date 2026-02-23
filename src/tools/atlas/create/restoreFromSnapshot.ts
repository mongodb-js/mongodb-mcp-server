import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs, CommonArgs } from "../../args.js";

export const RestoreFromSnapshotArgs = {
    projectId: AtlasArgs.projectId().describe("Source Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Source Atlas cluster name"),
    snapshotId: CommonArgs.objectId("snapshotId").describe("Snapshot ID to restore from"),
    targetProjectId: AtlasArgs.projectId().describe("Target Atlas project ID"),
    targetClusterName: AtlasArgs.clusterName().describe("Target Atlas cluster name"),
};

export class RestoreFromSnapshotTool extends AtlasToolBase {
    static toolName = "atlas-restore-from-snapshot";
    public description = "Create an Atlas restore job from a snapshot (automated restore only)";
    static operationType: OperationType = "create";
    public argsShape = {
        ...RestoreFromSnapshotArgs,
    };

    protected async execute({
        projectId,
        clusterName,
        snapshotId,
        targetProjectId,
        targetClusterName,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const restoreJob = await this.apiClient.createBackupRestoreJob({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
            body: {
                deliveryType: "automated",
                snapshotId,
                targetGroupId: targetProjectId,
                targetClusterName,
            },
        });

        const response = {
            restoreJobId: restoreJob.id ?? "N/A",
            deliveryType: restoreJob.deliveryType,
            snapshotId: restoreJob.snapshotId ?? snapshotId,
            targetProjectId: restoreJob.targetGroupId ?? targetProjectId,
            targetClusterName: restoreJob.targetClusterName ?? targetClusterName,
            failed: restoreJob.failed ?? false,
            cancelled: restoreJob.cancelled ?? false,
            finishedAt: restoreJob.finishedAt ? new Date(restoreJob.finishedAt).toISOString() : null,
            expiresAt: restoreJob.expiresAt ? new Date(restoreJob.expiresAt).toISOString() : null,
        };

        return {
            content: formatUntrustedData(
                `Restore job created for cluster "${clusterName}" in project ${projectId}`,
                JSON.stringify(response)
            ),
        };
    }
}
