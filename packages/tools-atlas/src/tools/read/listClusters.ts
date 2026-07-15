import type { CallToolResult, OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasToolBase } from "../../atlasTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import { formatUntrustedData } from "@mongodb-js/mcp-core";
import { z } from "zod";
import type {
    PaginatedClusterDescription20240805,
    PaginatedOrgGroupView,
    Group,
    PaginatedFlexClusters20241113,
} from "@mongodb-js/mcp-atlas-api-client";
import { formatCluster, formatFlexCluster } from "../../helpers/cluster.js";
import { AtlasArgs } from "../../args.js";

export const ListClustersArgs = {
    projectId: AtlasArgs.projectId().describe("Atlas project ID to filter clusters").optional(),
};

export const ClusterOutputSchema = {
    name: z.string().optional(),
    instanceType: z.enum(["FREE", "DEDICATED", "FLEX"]),
    instanceSize: z.string().optional(),
    provider: z.string().optional(),
    region: z.string().optional(),
    paused: z.boolean(),
    state: z.enum(["IDLE", "CREATING", "UPDATING", "DELETING", "REPAIRING"]).optional(),
    mongoDBVersion: z.string().optional(),
    connectionStrings: z.record(z.string(), z.unknown()).optional(),
    processIds: z.array(z.string()).optional(),
};

export const ClusterSummaryOutputSchema = z.object({
    clusterName: z.string().optional(),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
});

export const ListClusterItemOutputSchema = z.union([ClusterSummaryOutputSchema, z.object(ClusterOutputSchema)]);

const ListClustersOutputSchema = {
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    clusters: z.array(ListClusterItemOutputSchema),
    totalCount: z.number(),
};

export class ListClustersTool extends AtlasToolBase {
    static toolName = "atlas-list-clusters";
    public description = "List MongoDB Atlas clusters";
    static operationType: OperationType = "read";
    public argsShape = {
        ...ListClustersArgs,
    };
    public override outputSchema = ListClustersOutputSchema;

    protected async execute(
        { projectId }: ToolArgs<typeof this.argsShape>,
        context: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        if (!projectId) {
            const data = await this.apiClient.listClusterDetails(undefined, context);

            return this.formatAllClustersTable(data);
        } else {
            const project = await this.apiClient.getGroup(
                {
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                },
                context
            );

            if (!project?.id) {
                throw new Error(`Project with ID "${projectId}" not found.`);
            }

            const [clustersResult, flexClustersResult] = await Promise.allSettled([
                this.apiClient.listClusters(
                    {
                        params: {
                            path: {
                                groupId: project.id || "",
                            },
                        },
                    },
                    context
                ),
                this.apiClient.listFlexClusters(
                    {
                        params: {
                            path: {
                                groupId: project.id || "",
                            },
                        },
                    },
                    context
                ),
            ]);

            const clusters = clustersResult.status === "fulfilled" ? clustersResult.value : undefined;
            const flexClusters = flexClustersResult.status === "fulfilled" ? flexClustersResult.value : undefined;

            return this.formatClustersTable(project, clusters, flexClusters);
        }
    }

    private formatAllClustersTable(clusters?: PaginatedOrgGroupView): ToolResult<typeof ListClustersOutputSchema> {
        if (!clusters?.results?.length) {
            return {
                content: [{ type: "text", text: "No clusters found." }],
                structuredContent: {
                    clusters: [],
                    totalCount: 0,
                },
            };
        }
        const formattedClusters = clusters.results
            .map((result) => {
                return (result.clusters || []).map((cluster) => ({
                    projectName: result.groupName,
                    projectId: result.groupId,
                    clusterName: cluster.name,
                }));
            })
            .flat();
        if (!formattedClusters.length) {
            return {
                content: [{ type: "text", text: "No clusters found." }],
                structuredContent: {
                    clusters: [],
                    totalCount: 0,
                },
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${formattedClusters.length} clusters across all projects`,
                JSON.stringify(formattedClusters)
            ),
            structuredContent: {
                clusters: formattedClusters,
                totalCount: formattedClusters.length,
            },
        };
    }

    private formatClustersTable(
        project: Group,
        clusters: PaginatedClusterDescription20240805 | undefined,
        flexClusters: PaginatedFlexClusters20241113 | undefined
    ): ToolResult<typeof ListClustersOutputSchema> {
        // Check if both traditional clusters and flex clusters are absent
        if (!clusters?.results?.length && !flexClusters?.results?.length) {
            return {
                content: [{ type: "text", text: "No clusters found." }],
                structuredContent: {
                    projectId: project.id,
                    projectName: project.name,
                    clusters: [],
                    totalCount: 0,
                },
            };
        }
        const formattedClusters = clusters?.results?.map((cluster) => formatCluster(cluster)) || [];
        const formattedFlexClusters = flexClusters?.results?.map((cluster) => formatFlexCluster(cluster)) || [];
        const allClusters = [...formattedClusters, ...formattedFlexClusters];

        return {
            content: formatUntrustedData(
                `Found ${allClusters.length} clusters in project ${project.id}:`,
                JSON.stringify({ projectName: project.name, clusters: allClusters })
            ),
            structuredContent: {
                projectId: project.id,
                projectName: project.name,
                clusters: allClusters,
                totalCount: allClusters.length,
            },
        };
    }
}
