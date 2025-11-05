import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type OperationType, type ToolArgs, formatUntrustedData } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { Cluster } from "../../../common/atlas/cluster.js";
import { inspectCluster } from "../../../common/atlas/cluster.js";
import { AtlasArgs } from "../../args.js";

export const InspectClusterArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
};

export class InspectClusterTool extends AtlasToolBase {
    public name = "atlas-inspect-cluster";
    public description = "Inspect MongoDB Atlas cluster";
    public operationType: OperationType = "read";
    public argsShape = {
        ...InspectClusterArgs,
    };

    public async execute({ projectId, clusterName }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const cluster = await inspectCluster(this.session.apiClient, projectId, clusterName);

        return this.formatOutput(cluster);
    }

    private formatOutput(formattedCluster: Cluster): CallToolResult {
        return {
            content: formatUntrustedData(
                "Cluster details:",
                `Cluster Name | Cluster Type | Tier | State | MongoDB Version | Connection String
----------------|----------------|----------------|----------------|----------------|----------------
${formattedCluster.name || "Unknown"} | ${formattedCluster.instanceType} | ${formattedCluster.instanceSize || "N/A"} | ${formattedCluster.state || "UNKNOWN"} | ${formattedCluster.mongoDBVersion || "N/A"} | ${formattedCluster.connectionStrings?.standardSrv || formattedCluster.connectionStrings?.standard || "N/A"}`
            ),
        };
    }
}
