import { LogId } from "../logger.js";
import type { ApiClient } from "./apiClient.js";
import { getProcessIdsFromCluster } from "./cluster.js";
import type { components } from "./openapi.js";

export type SuggestedIndex = components["schemas"]["PerformanceAdvisorIndex"];
export type DropIndexSuggestion = components["schemas"]["DropIndexSuggestionsIndex"];
export type SlowQueryLogMetrics = components["schemas"]["PerformanceAdvisorSlowQueryMetrics"];
export type SlowQueryLog = components["schemas"]["PerformanceAdvisorSlowQuery"];

interface SuggestedIndexesResponse {
    content: components["schemas"]["PerformanceAdvisorResponse"];
}
interface DropIndexesResponse {
    content: components["schemas"]["DropIndexSuggestionsResponse"];
}
interface SchemaAdviceResponse {
    content: components["schemas"]["SchemaAdvisorResponse"];
}
export type SchemaRecommendation = components["schemas"]["SchemaAdvisorItemRecommendation"];

export async function getSuggestedIndexes(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string
): Promise<{ suggestedIndexes: Array<SuggestedIndex> }> {
    try {
        const response = await apiClient.listClusterSuggestedIndexes({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        return {
            suggestedIndexes: (response as SuggestedIndexesResponse).content.suggestedIndexes ?? [],
        };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaSuggestedIndexesFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list suggested indexes: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list suggested indexes: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function getDropIndexSuggestions(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string
): Promise<{
    hiddenIndexes: Array<DropIndexSuggestion>;
    redundantIndexes: Array<DropIndexSuggestion>;
    unusedIndexes: Array<DropIndexSuggestion>;
}> {
    try {
        const response = await apiClient.listDropIndexes({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        return {
            hiddenIndexes: (response as DropIndexesResponse).content.hiddenIndexes ?? [],
            redundantIndexes: (response as DropIndexesResponse).content.redundantIndexes ?? [],
            unusedIndexes: (response as DropIndexesResponse).content.unusedIndexes ?? [],
        };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaDropIndexSuggestionsFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list drop index suggestions: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list drop index suggestions: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function getSchemaAdvice(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string
): Promise<{ recommendations: Array<SchemaRecommendation> }> {
    try {
        const response = await apiClient.listSchemaAdvice({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        return { recommendations: (response as SchemaAdviceResponse).content.recommendations ?? [] };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaSchemaAdviceFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list schema advice: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list schema advice: ${err instanceof Error ? err.message : String(err)}`);
    }
}

export async function getSlowQueries(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string,
    since?: Date,
    namespaces?: Array<string>
): Promise<{ slowQueryLogs: Array<SlowQueryLog> }> {
    try {
        const processIds = await getProcessIdsFromCluster(apiClient, projectId, clusterName);

        if (processIds.length === 0) {
            return { slowQueryLogs: [] };
        }

        const slowQueryPromises = processIds.map((processId) =>
            apiClient.listSlowQueries({
                params: {
                    path: {
                        groupId: projectId,
                        processId,
                    },
                    query: {
                        ...(since && { since: since.getTime() }),
                        ...(namespaces && { namespaces: namespaces }),
                    },
                },
            })
        );

        const responses = await Promise.all(slowQueryPromises);

        const allSlowQueryLogs = responses.reduce((acc, response) => {
            return acc.concat(response.slowQueries ?? []);
        }, [] as Array<SlowQueryLog>);

        return { slowQueryLogs: allSlowQueryLogs };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaSlowQueryLogsFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`);
    }
}
