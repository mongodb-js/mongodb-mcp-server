import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { AtlasArgs, CommonArgs } from "../../args.js";

export const CreateBackupSnapshotArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
    description: CommonArgs.string().optional().describe("Optional snapshot description"),
};

export class CreateBackupSnapshotTool extends AtlasToolBase {
    static toolName = "atlas-create-backup-snapshot";
    public description = "Create an on-demand backup snapshot for an Atlas cluster";
    static operationType: OperationType = "create";
    public argsShape = {
        ...CreateBackupSnapshotArgs,
    };

    protected async execute({
        projectId,
        clusterName,
        description,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const snapshot = await this.apiClient.takeSnapshots({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
            body: {
                ...(description ? { description } : {}),
            },
        });

        const response = {
            snapshotId: snapshot.id ?? "N/A",
            snapshotType: snapshot.snapshotType ?? "N/A",
            status: snapshot.status ?? "N/A",
            description: snapshot.description ?? description ?? null,
            createdAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : null,
            expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt).toISOString() : null,
            frequencyType: snapshot.frequencyType ?? "N/A",
        };

        return {
            content: formatUntrustedData(
                `On-demand backup snapshot created for cluster "${clusterName}" in project ${projectId}`,
                JSON.stringify(response)
            ),
        };
    }
}
