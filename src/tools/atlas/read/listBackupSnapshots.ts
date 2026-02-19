import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs } from "../../args.js";

export const ListBackupSnapshotsArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
};

export class ListBackupSnapshotsTool extends AtlasToolBase {
    static toolName = "atlas-list-backup-snapshots";
    public description = "Get a list of backup snapshots for an Atlas cluster";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListBackupSnapshotsArgs,
    };

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data = await this.apiClient.listBackupSnapshots({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });

        if (!data?.results?.length) {
            return {
                content: [
                    {
                        type: "text",
                        text: `No backup snapshots found for cluster "${clusterName}" in project ${projectId}.`,
                    },
                ],
            };
        }

        const snapshots = data.results.map((snapshot) => ({
            id: snapshot.id ?? "N/A",
            snapshotType: snapshot.snapshotType ?? "N/A",
            createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : "N/A",
            status: snapshot.status ?? "N/A",
            expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString() : "N/A",
            frequencyType: snapshot.frequencyType ?? "N/A",
            storageSizeBytes: snapshot.storageSizeBytes ?? "N/A",
            cloudProvider: snapshot.cloudProvider ?? "N/A",
            type: snapshot.type ?? "N/A",
        }));

        return {
            content: formatUntrustedData(
                `Found ${snapshots.length} backup snapshots for cluster "${clusterName}" in project ${projectId}`,
                JSON.stringify(snapshots)
            ),
        };
    }
}
