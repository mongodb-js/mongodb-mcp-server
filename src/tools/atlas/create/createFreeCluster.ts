import { z } from "zod";
import { type ToolArgs, type OperationType, type ToolExecutionContext, type ToolResult } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";

const CreateFreeClusterOutputSchema = {
    name: z.string(),
    region: z.string(),
};

export class CreateFreeClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-free-cluster";
    public description = "Create a free MongoDB Atlas cluster";
    static operationType: OperationType = "create";
    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
        name: AtlasArgs.clusterName().describe("Name of the cluster"),
        region: AtlasArgs.region().describe("Region of the cluster").default("US_EAST_1"),
    };
    public override outputSchema = CreateFreeClusterOutputSchema;

    protected async execute(
        { projectId, name, region }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const input = {
            groupId: projectId,
            name,
            clusterType: "REPLICASET",
            replicationSpecs: [
                {
                    zoneName: "Zone 1",
                    regionConfigs: [
                        {
                            providerName: "TENANT",
                            backingProviderName: "AWS",
                            regionName: region,
                            electableSpecs: {
                                instanceSize: "M0",
                            },
                        },
                    ],
                },
            ],
            terminationProtectionEnabled: false,
        } as unknown as ClusterDescription20240805;

        await ensureCurrentIpInAccessList(this.apiClient, projectId, context);
        await this.apiClient.createCluster(
            {
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
                body: input,
            },
            context
        );

        return {
            content: [
                { type: "text", text: `Cluster "${name}" has been created in region "${region}".` },
                { type: "text", text: `Double check your access lists to enable your current IP.` },
            ],
            structuredContent: {
                name,
                region,
            },
        };
    }
}
