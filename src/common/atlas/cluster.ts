import type { ClusterDescription20240805, FlexClusterDescription20241113 } from "./openapi.js";
import type { ApiClient } from "./apiClient.js";
import { LogId } from "../logger.js";

const DEFAULT_PORT = "27017";
export interface Cluster {
    name?: string;
    instanceType: "FREE" | "DEDICATED" | "FLEX";
    instanceSize?: string;
    state?: "IDLE" | "CREATING" | "UPDATING" | "DELETING" | "REPAIRING";
    mongoDBVersion?: string;
    connectionString?: string;
}

export function formatFlexCluster(cluster: FlexClusterDescription20241113): Cluster {
    return {
        name: cluster.name,
        instanceType: "FLEX",
        instanceSize: undefined,
        state: cluster.stateName,
        mongoDBVersion: cluster.mongoDBVersion,
        connectionString: cluster.connectionStrings?.standardSrv || cluster.connectionStrings?.standard,
    };
}

export function formatCluster(cluster: ClusterDescription20240805): Cluster {
    const regionConfigs = (cluster.replicationSpecs || [])
        .map(
            (replicationSpec) =>
                (replicationSpec.regionConfigs || []) as {
                    providerName: string;
                    electableSpecs?: {
                        instanceSize: string;
                    };
                    readOnlySpecs?: {
                        instanceSize: string;
                    };
                    analyticsSpecs?: {
                        instanceSize: string;
                    };
                }[]
        )
        .flat()
        .map((regionConfig) => {
            return {
                providerName: regionConfig.providerName,
                instanceSize:
                    regionConfig.electableSpecs?.instanceSize ||
                    regionConfig.readOnlySpecs?.instanceSize ||
                    regionConfig.analyticsSpecs?.instanceSize,
            };
        });

    const instanceSize = regionConfigs[0]?.instanceSize ?? "UNKNOWN";
    const clusterInstanceType = instanceSize === "M0" ? "FREE" : "DEDICATED";

    return {
        name: cluster.name,
        instanceType: clusterInstanceType,
        instanceSize: clusterInstanceType === "DEDICATED" ? instanceSize : undefined,
        state: cluster.stateName,
        mongoDBVersion: cluster.mongoDBVersion,
        connectionString: cluster.connectionStrings?.standardSrv || cluster.connectionStrings?.standard,
    };
}

export async function inspectCluster(apiClient: ApiClient, projectId: string, clusterName: string): Promise<Cluster> {
    try {
        const cluster = await apiClient.getCluster({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        return formatCluster(cluster);
    } catch (error) {
        try {
            const cluster = await apiClient.getFlexCluster({
                params: {
                    path: {
                        groupId: projectId,
                        name: clusterName,
                    },
                },
            });
            return formatFlexCluster(cluster);
        } catch (flexError) {
            const err = flexError instanceof Error ? flexError : new Error(String(flexError));
            apiClient.logger.error({
                id: LogId.atlasInspectFailure,
                context: "inspect-cluster",
                message: `error inspecting cluster: ${err.message}`,
            });
            throw error;
        }
    }
}

export async function getProcessIdFromCluster(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string
): Promise<string> {
    try {
        const cluster = await inspectCluster(apiClient, projectId, clusterName);
        if (!cluster.connectionString) {
            throw new Error("No connection string available for cluster");
        }
        const url = new URL(cluster.connectionString);
        return `${url.hostname}:${url.port || DEFAULT_PORT}`;
    } catch (error) {
        throw new Error(
            `Failed to get processId from cluster: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
