import { LogId } from "../logger.js";
import type { ApiClient } from "./apiClient.js";
import { getProcessIdFromCluster } from "./cluster.js";
import type { components } from "./openapi.js";

export type SuggestedIndex = components["schemas"]["PerformanceAdvisorIndex"];

export type DropIndexSuggestion = components["schemas"]["DropIndexSuggestionsIndex"];

export type SlowQueryLogMetrics = components["schemas"]["PerformanceAdvisorSlowQueryMetrics"];

export type SlowQueryLog = components["schemas"]["PerformanceAdvisorSlowQuery"];

interface SuggestedIndexesResponse {
    content: {
        suggestedIndexes?: Array<SuggestedIndex>;
    };
}

interface DropIndexesResponse {
    content: {
        hiddenIndexes?: Array<DropIndexSuggestion>;
        redundantIndexes?: Array<DropIndexSuggestion>;
        unusedIndexes?: Array<DropIndexSuggestion>;
    };
}

interface SchemaAdviceResponse {
    content: {
        recommendations?: Array<SchemaRecommendation>;
    };
}

interface SlowQueriesResponse {
    slowQueries?: Array<SlowQueryLog>;
}

export type SchemaTriggerType =
    | "PERCENT_QUERIES_USE_LOOKUP"
    | "NUMBER_OF_QUERIES_USE_LOOKUP"
    | "DOCS_CONTAIN_UNBOUNDED_ARRAY"
    | "NUMBER_OF_NAMESPACES"
    | "DOC_SIZE_TOO_LARGE"
    | "NUM_INDEXES"
    | "QUERIES_CONTAIN_CASE_INSENSITIVE_REGEX";

export const SCHEMA_TRIGGER_DESCRIPTIONS: Record<SchemaTriggerType, string> = {
    PERCENT_QUERIES_USE_LOOKUP: "High percentage of queries (>50%) use $lookup operations",
    NUMBER_OF_QUERIES_USE_LOOKUP: "High number of queries (>100) use $lookup operations",
    DOCS_CONTAIN_UNBOUNDED_ARRAY: "Arrays with over 10000 entries detected in the collection(s)",
    NUMBER_OF_NAMESPACES: "Too many namespaces (collections) in the database (>100)",
    DOC_SIZE_TOO_LARGE: "Documents larger than 2 MB found in the collection(s)",
    NUM_INDEXES: "More than 30 indexes detected in the collection(s) scanned",
    QUERIES_CONTAIN_CASE_INSENSITIVE_REGEX: "Queries use case-insensitive regular expressions",
};

type SchemaRecommedationType =
    | "REDUCE_LOOKUP_OPS"
    | "AVOID_UNBOUNDED_ARRAY"
    | "REDUCE_DOCUMENT_SIZE"
    | "REMOVE_UNNECESSARY_INDEXES"
    | "REDUCE_NUMBER_OF_NAMESPACES"
    | "OPTIMIZE_CASE_INSENSITIVE_REGEX_QUERIES"
    | "OPTIMIZE_TEXT_QUERIES";

export const SCHEMA_RECOMMENDATION_DESCRIPTIONS: Record<SchemaRecommedationType, string> = {
    REDUCE_LOOKUP_OPS: "Reduce the use of $lookup operations",
    AVOID_UNBOUNDED_ARRAY: "Avoid using unbounded arrays in documents",
    REDUCE_DOCUMENT_SIZE: "Reduce the size of documents",
    REMOVE_UNNECESSARY_INDEXES: "Remove unnecessary indexes",
    REDUCE_NUMBER_OF_NAMESPACES: "Reduce the number of collections in the database",
    OPTIMIZE_CASE_INSENSITIVE_REGEX_QUERIES: "Optimize case-insensitive regex queries",
    OPTIMIZE_TEXT_QUERIES: "Optimize text search queries",
};

export interface SchemaRecommendation {
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
        const processId = await getProcessIdFromCluster(apiClient, projectId, clusterName);

        const response = await apiClient.listSlowQueries({
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
        });

        return { slowQueryLogs: (response as SlowQueriesResponse).slowQueries ?? [] };
    } catch (err) {
        apiClient.logger.debug({
            id: LogId.atlasPaSlowQueryLogsFailure,
            context: "performanceAdvisorUtils",
            message: `Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`,
        });
        throw new Error(`Failed to list slow query logs: ${err instanceof Error ? err.message : String(err)}`);
    }
}
