import { LogId } from "../logger.js";
import type { ApiClient } from "./apiClient.js";
import { getProcessIdFromCluster } from "./cluster.js";

export enum PerformanceAdvisorOperation {
    SUGGESTED_INDEXES = "suggestedIndexes",
    DROP_INDEX_SUGGESTIONS = "dropIndexSuggestions",
    SLOW_QUERY_LOGS = "slowQueryLogs",
    SCHEMA_SUGGESTIONS = "schemaSuggestions",
}

interface SuggestedIndex {
    avgObjSize?: number;
    id?: string;
    impact?: Array<string>;
    index?: Array<{ [key: string]: 1 | -1 }>;
    namespace?: string;
    weight?: number;
}

interface DropIndexSuggestion {
    accessCount?: number;
    index?: Array<{ [key: string]: 1 | -1 }>;
    name?: string;
    namespace?: string;
    shards?: Array<string>;
    since?: string;
    sizeBytes?: number;
}

type SchemaTriggerType =
    | "PERCENT_QUERIES_USE_LOOKUP"
    | "NUMBER_OF_QUERIES_USE_LOOKUP"
    | "DOCS_CONTAIN_UNBOUNDED_ARRAY"
    | "NUMBER_OF_NAMESPACES"
    | "DOC_SIZE_TOO_LARGE"
    | "NUM_INDEXES"
    | "QUERIES_CONTAIN_CASE_INSENSITIVE_REGEX";

type SchemaRecommedationType =
    | "REDUCE_LOOKUP_OPS"
    | "AVOID_UNBOUNDED_ARRAY"
    | "REDUCE_DOCUMENT_SIZE"
    | "REMOVE_UNNECESSARY_INDEXES"
    | "REDUCE_NUMBER_OF_NAMESPACES"
    | "OPTIMIZE_CASE_INSENSITIVE_REGEX_QUERIES"
    | "OPTIMIZE_TEXT_QUERIES";

interface SchemaRecommendation {
    affectedNamespaces?: Array<{
        namespace?: string | null;
        triggers?: Array<{
            description?: string;
            triggerType?: SchemaTriggerType;
        }>;
    }>;
    description?: string;
    recommendation?: SchemaRecommedationType;
}

interface SlowQueryLogMetrics {
    docsExamined?: number;
    docsExaminedReturnedRatio?: number;
    docsReturned?: number;
    fromUserConnection?: boolean;
    hasIndexCoverage?: boolean;
    hasSort?: boolean;
    keysExamined?: number;
    keysExaminedReturnedRatio?: number;
    numYields?: number;
    operationExecutionTime?: number;
    responseLength?: number;
}

interface SlowQueryLog {
    line?: string;
    metrics?: SlowQueryLogMetrics;
    namespace?: string;
    opType?: string;
    replicaState?: string;
}

export interface PerformanceAdvisorData {
    suggestedIndexes: Array<SuggestedIndex>;
    dropIndexSuggestions: {
        hiddenIndexes: Array<DropIndexSuggestion>;
        redundantIndexes: Array<DropIndexSuggestion>;
        unusedIndexes: Array<DropIndexSuggestion>;
    };
    slowQueryLogs: Array<SlowQueryLog>;
    schemaSuggestions: Array<SchemaRecommendation>;
}

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
        return { suggestedIndexes: response?.content?.suggestedIndexes ?? [] };
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
            hiddenIndexes: response?.content?.hiddenIndexes ?? [],
            redundantIndexes: response?.content?.redundantIndexes ?? [],
            unusedIndexes: response?.content?.unusedIndexes ?? [],
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
        return { recommendations: response?.content?.recommendations ?? [] };
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
    since?: number,
    processId?: string,
    namespaces?: string[]
): Promise<{ slowQueryLogs: Array<SlowQueryLog> }> {
    try {
        // If processId is not provided, get it from inspecting the cluster
        let actualProcessId = processId;
        if (!actualProcessId) {
            actualProcessId = await getProcessIdFromCluster(apiClient, projectId, clusterName);
        }

        const response = await apiClient.listSlowQueries({
            params: {
                path: {
                    groupId: projectId,
                    processId: actualProcessId,
                },
                query: {
                    ...(since && { since: Number(since) }),
                    ...(namespaces && { namespaces: namespaces }),
                },
            },
        });

        return { slowQueryLogs: response?.slowQueries ?? [] };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaSlowQueryLogsFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`);
    }
}
