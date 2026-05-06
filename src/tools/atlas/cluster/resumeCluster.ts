import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import { AtlasArgs } from "../../args.js";

export class ResumeClusterTool extends AtlasToolBase {
    static toolName = "atlas-resume-cluster";
    public description =
        "Resume a paused Atlas dedicated cluster by name, restarting compute billing. " +
        "The cluster will be available for connections within a few minutes.";
    static operationType: OperationType = "update";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID (24-char hex)"),
        clusterName: AtlasArgs.clusterName().describe("Name of the cluster to resume"),
    };

    protected async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        await this.apiClient.updateCluster(projectId, clusterName, { paused: false });
        return {
            content: [{ type: "text", text: `Cluster "${clusterName}" is being resumed.` }],
        };
    }
}
