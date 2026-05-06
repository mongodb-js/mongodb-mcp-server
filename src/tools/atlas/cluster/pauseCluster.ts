import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";

export class PauseClusterTool extends AtlasToolBase {
    static toolName = "atlas-pause-cluster";
    public description =
        "Pause a running Atlas dedicated cluster by name, stopping compute billing. " +
        "Storage continues to be billed while paused. Use for dev/test clusters not in active use. " +
        "A cluster cannot be paused if it is already paused or if backups are in progress.";
    static operationType: OperationType = "update";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID (24-char hex)"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to pause"),
    };

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        await this.apiClient.updateCluster(projectId, clusterName, { paused: true });
        return {
            content: [{ type: "text", text: `Cluster "${clusterName}" is being paused.` }],
        };
    }
}
