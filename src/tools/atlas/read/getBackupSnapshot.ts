import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs, CommonArgs } from "../../args.js";

export const GetBackupSnapshotArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
    snapshotId: CommonArgs.objectId("snapshotId").describe("Snapshot ID"),
};

export class GetBackupSnapshotTool extends AtlasToolBase {
    static toolName = "atlas-get-backup-snapshot";
    public description = "Get backup snapshot metadata for an Atlas cluster";
    static operationType: OperationType = "read";
    public argsShape = {
        ...GetBackupSnapshotArgs,
    };

    protected async execute({
        projectId,
        clusterName,
        snapshotId,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const snapshot = await this.apiClient.getClusterBackupSnapshot({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                    snapshotId,
                },
            },
        });

        const snapshotDetails = {
            id: snapshot.id ?? "N/A",
            snapshotType: snapshot.snapshotType ?? "N/A",
            createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : "N/A",
            status: snapshot.status ?? "N/A",
            expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString() : "N/A",
            frequencyType: snapshot.frequencyType ?? "N/A",
            storageSizeBytes: snapshot.storageSizeBytes ?? "N/A",
            cloudProvider: snapshot.cloudProvider ?? "N/A",
            type: snapshot.type ?? "N/A",
            replicaSetName: snapshot.replicaSetName ?? "N/A",
            mongodVersion: snapshot.mongodVersion ?? "N/A",
        };

        return {
            content: formatUntrustedData(
                `Backup snapshot "${snapshotId}" for cluster "${clusterName}" in project ${projectId}`,
                JSON.stringify(snapshotDetails)
            ),
        };
    }
}
