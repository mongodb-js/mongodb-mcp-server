import { z } from "zod";
import {
    type OperationType,
    type ToolArgs,
    type ToolExecutionContext,
    type ToolResult,
    formatUntrustedData,
} from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { Cluster } from "../../../common/atlas/cluster.js";
import { inspectCluster } from "../../../common/atlas/cluster.js";
import { AtlasArgs } from "../../args.js";

export const InspectClusterArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID"),
    clusterName: AtlasArgs.clusterName().describe("Atlas cluster name"),
};

const InspectClusterOutputSchema = {
    name: z.string(),
    instanceType: z.enum(["FREE", "DEDICATED", "FLEX"]),
    instanceSize: z.string(),
    provider: z.string().optional(),
    region: z.string().optional(),
    paused: z.boolean(),
    state: z.string(),
    mongoDBVersion: z.string(),
    connectionStrings: z.record(z.string(), z.unknown()),
};

export class InspectClusterTool extends AtlasToolBase {
    static toolName = "atlas-inspect-cluster";
    public description = "Inspect metadata of a MongoDB Atlas cluster";
    static operationType: OperationType = "read";
    public argsShape = {
        ...InspectClusterArgs,
    };
    public override outputSchema = InspectClusterOutputSchema;

    protected async execute(
        { projectId, clusterName }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const cluster = await inspectCluster(this.apiClient, projectId, clusterName, context);

        return this.formatOutput(cluster);
    }

    private formatOutput(formattedCluster: Cluster): ToolResult<typeof InspectClusterOutputSchema> {
        const structuredContent = {
            name: formattedCluster.name || "Unknown",
            instanceType: formattedCluster.instanceType,
            instanceSize: formattedCluster.instanceSize || "N/A",
            provider: formattedCluster.provider,
            region: formattedCluster.region,
            paused: formattedCluster.paused,
            state: formattedCluster.state || "UNKNOWN",
            mongoDBVersion: formattedCluster.mongoDBVersion || "N/A",
            connectionStrings: formattedCluster.connectionStrings || {},
        };

        return {
            content: formatUntrustedData("Cluster details:", JSON.stringify(structuredContent)),
            structuredContent,
        };
    }
}
