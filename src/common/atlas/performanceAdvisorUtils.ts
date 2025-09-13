import { LogId } from "../logger.js";
import type { ApiClient } from "./apiClient.js";
import { getProcessIdFromCluster } from "./cluster.js";

export enum PerformanceAdvisorOperation {
    SUGGESTED_INDEXES = "suggestedIndexes",
    DROP_INDEX_SUGGESTIONS = "dropIndexSuggestions",
    SLOW_QUERY_LOGS = "slowQueryLogs",
    SCHEMA_SUGGESTIONS = "schemaSuggestions",
}

export interface SuggestedIndex {
    avgObjSize?: number;
    id?: string;
    impact?: Array<string>;
    index?: Array<{ [key: string]: 1 | -1 }>;
    namespace?: string;
    weight?: number;
}

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

export interface DropIndexSuggestion {
    accessCount?: number;
    index?: Array<{ [key: string]: 1 | -1 }>;
    name?: string;
    namespace?: string;
    shards?: Array<string>;
    since?: string;
    sizeBytes?: number;
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

export interface SlowQueryLog {
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
    processId?: string,
    namespaces?: Array<string>
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

export function formatSuggestedIndexesTable(suggestedIndexes: Array<SuggestedIndex>): string {
    if (suggestedIndexes.length === 0) return "No suggested indexes found.";

    const rows = suggestedIndexes
        .map((index, i) => {
            const namespace = index.namespace ?? "N/A";
            const weight = index.weight ?? "N/A";
            const avgObjSize = index.avgObjSize ?? "N/A";
            const indexKeys = index.index ? index.index.map((key) => Object.keys(key)[0]).join(", ") : "N/A";
            return `${i + 1} | ${namespace} | ${weight} | ${avgObjSize} | ${indexKeys}`;
        })
        .join("\n");

    return `# | Namespace | Weight | Avg Obj Size | Index Keys
---|-----------|--------|--------------|------------
${rows}`;
}

export function formatDropIndexesTable(dropIndexSuggestions: {
    hiddenIndexes: Array<DropIndexSuggestion>;
    redundantIndexes: Array<DropIndexSuggestion>;
    unusedIndexes: Array<DropIndexSuggestion>;
}): string {
    const allIndexes = [
        ...dropIndexSuggestions.hiddenIndexes.map((idx) => ({ ...idx, type: "Hidden" })),
        ...dropIndexSuggestions.redundantIndexes.map((idx) => ({ ...idx, type: "Redundant" })),
        ...dropIndexSuggestions.unusedIndexes.map((idx) => ({ ...idx, type: "Unused" })),
    ];

    if (allIndexes.length === 0) return "No drop index suggestions found.";

    const rows = allIndexes
        .map((index, i) => {
            const name = index.name ?? "N/A";
            const namespace = index.namespace ?? "N/A";
            const type = index.type ?? "N/A";
            const sizeBytes = index.sizeBytes ?? "N/A";
            const accessCount = index.accessCount ?? "N/A";
            return `${i + 1} | ${name} | ${namespace} | ${type} | ${sizeBytes} | ${accessCount}`;
        })
        .join("\n");

    return `# | Index Name | Namespace | Type | Size (bytes) | Access Count
---|------------|-----------|------|--------------|-------------
${rows}`;
}

export function formatSlowQueriesTable(slowQueryLogs: Array<SlowQueryLog>): string {
    if (slowQueryLogs.length === 0) return "No slow query logs found.";

    const rows = slowQueryLogs
        .map((log, i) => {
            const namespace = log.namespace ?? "N/A";
            const opType = log.opType ?? "N/A";
            const executionTime = log.metrics?.operationExecutionTime ?? "N/A";
            const docsExamined = log.metrics?.docsExamined ?? "N/A";
            const docsReturned = log.metrics?.docsReturned ?? "N/A";
            return `${i + 1} | ${namespace} | ${opType} | ${executionTime}ms | ${docsExamined} | ${docsReturned}`;
        })
        .join("\n");

    return `# | Namespace | Operation | Execution Time | Docs Examined | Docs Returned
---|-----------|-----------|---------------|---------------|---------------
${rows}`;
}

function getTriggerDescription(triggerType: SchemaTriggerType | undefined): string {
    if (!triggerType) return "N/A";
    return SCHEMA_TRIGGER_DESCRIPTIONS[triggerType] ?? triggerType;
}

function getNamespaceTriggerDescriptions(namespace: { triggers?: Array<{ triggerType?: SchemaTriggerType }> }): string {
    if (!namespace.triggers) return "N/A";

    return namespace.triggers.map((trigger) => getTriggerDescription(trigger.triggerType)).join(", ");
}

function getTriggerDescriptions(suggestion: SchemaRecommendation): string {
    if (!suggestion.affectedNamespaces) return "N/A";

    return suggestion.affectedNamespaces.map((namespace) => getNamespaceTriggerDescriptions(namespace)).join(", ");
}

export function formatSchemaSuggestionsTable(schemaSuggestions: Array<SchemaRecommendation>): string {
    if (schemaSuggestions.length === 0) return "No schema suggestions found.";

    const rows = schemaSuggestions
        .map((suggestion: SchemaRecommendation, i) => {
            const recommendation = suggestion.recommendation
                ? (SCHEMA_RECOMMENDATION_DESCRIPTIONS[suggestion.recommendation] ?? suggestion.recommendation)
                : "N/A";
            const description = suggestion.description ?? "N/A";
            const triggeredBy = getTriggerDescriptions(suggestion);
            const affectedNamespaces = suggestion.affectedNamespaces?.length ?? 0;
            return `${i + 1} | ${recommendation} | ${description} | ${triggeredBy} | ${affectedNamespaces} namespaces`;
        })
        .join("\n");

    return `# | Recommendation | Description | Triggered By | Affected Namespaces
---|---------------|-------------|----------|-------------------
${rows}`;
}
