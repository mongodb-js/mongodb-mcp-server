import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import {
    getSuggestedIndexes,
    getDropIndexSuggestions,
    getSchemaAdvice,
    getSlowQueries,
    PerformanceAdvisorOperation,
    type PerformanceAdvisorData,
    type SuggestedIndex,
    type DropIndexSuggestion,
    type SlowQueryLog,
    type SchemaRecommendation,
    SCHEMA_RECOMMENDATION_DESCRIPTIONS,
    SCHEMA_TRIGGER_DESCRIPTIONS,
    type SchemaTriggerType,
} from "../../../common/atlas/performanceAdvisorUtils.js";

export class ListPerformanceAdvisorTool extends AtlasToolBase {
    public name = "atlas-list-performance-advisor";
    protected description = "List MongoDB Atlas performance advisor recommendations";
    public operationType: OperationType = "read";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID to list performance advisor recommendations"),
        clusterName: z.string().describe("Atlas cluster name to list performance advisor recommendations"),
        operations: z
            .array(z.nativeEnum(PerformanceAdvisorOperation))
            .default(Object.values(PerformanceAdvisorOperation))
            .describe("Operations to list performance advisor recommendations"),
        since: z.date().describe("Date to list slow query logs since").optional(),
        processId: z.string().describe("Process ID to list slow query logs").optional(),
        namespaces: z.array(z.string()).describe("Namespaces to list slow query logs").optional(),
    };

    private formatSuggestedIndexesTable(suggestedIndexes: Array<SuggestedIndex>): string {
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

    private formatDropIndexesTable(dropIndexSuggestions: {
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

    private formatSlowQueriesTable(slowQueryLogs: Array<SlowQueryLog>): string {
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

    private getTriggerDescription(triggerType: SchemaTriggerType | undefined): string {
        if (!triggerType) return "N/A";
        return SCHEMA_TRIGGER_DESCRIPTIONS[triggerType] ?? triggerType;
    }

    private getNamespaceTriggerDescriptions(namespace: {
        triggers?: Array<{ triggerType?: SchemaTriggerType }>;
    }): string {
        if (!namespace.triggers) return "N/A";

        return namespace.triggers.map((trigger) => this.getTriggerDescription(trigger.triggerType)).join(", ");
    }

    private getTriggerDescriptions(suggestion: SchemaRecommendation): string {
        if (!suggestion.affectedNamespaces) return "N/A";

        return suggestion.affectedNamespaces
            .map((namespace) => this.getNamespaceTriggerDescriptions(namespace))
            .join(", ");
    }

    private formatSchemaSuggestionsTable(schemaSuggestions: Array<SchemaRecommendation>): string {
        if (schemaSuggestions.length === 0) return "No schema suggestions found.";

        const rows = schemaSuggestions
            .map((suggestion: SchemaRecommendation, i) => {
                const recommendation = suggestion.recommendation
                    ? (SCHEMA_RECOMMENDATION_DESCRIPTIONS[suggestion.recommendation] ?? suggestion.recommendation)
                    : "N/A";
                const description = suggestion.description ?? "N/A";
                const triggeredBy = this.getTriggerDescriptions(suggestion);
                const affectedNamespaces = suggestion.affectedNamespaces?.length ?? 0;
                return `${i + 1} | ${recommendation} | ${description} | ${triggeredBy} | ${affectedNamespaces} namespaces`;
            })
            .join("\n");

        return `# | Recommendation | Description | Triggered By | Affected Namespaces
---|---------------|-------------|----------|-------------------
${rows}`;
    }

    protected async execute({
        projectId,
        clusterName,
        operations,
        since,
        processId,
        namespaces,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data: PerformanceAdvisorData = {
            suggestedIndexes: [],
            dropIndexSuggestions: { hiddenIndexes: [], redundantIndexes: [], unusedIndexes: [] },
            slowQueryLogs: [],
            schemaSuggestions: [],
        };

        try {
            const performanceAdvisorPromises = [];

            if (operations.includes(PerformanceAdvisorOperation.SUGGESTED_INDEXES)) {
                performanceAdvisorPromises.push(
                    getSuggestedIndexes(this.session.apiClient, projectId, clusterName).then(({ suggestedIndexes }) => {
                        data.suggestedIndexes = suggestedIndexes;
                    })
                );
            }

            if (operations.includes(PerformanceAdvisorOperation.DROP_INDEX_SUGGESTIONS)) {
                performanceAdvisorPromises.push(
                    getDropIndexSuggestions(this.session.apiClient, projectId, clusterName).then(
                        ({ hiddenIndexes, redundantIndexes, unusedIndexes }) => {
                            data.dropIndexSuggestions = { hiddenIndexes, redundantIndexes, unusedIndexes };
                        }
                    )
                );
            }

            if (operations.includes(PerformanceAdvisorOperation.SLOW_QUERY_LOGS)) {
                performanceAdvisorPromises.push(
                    getSlowQueries(this.session.apiClient, projectId, clusterName, since, processId, namespaces).then(
                        ({ slowQueryLogs }) => {
                            data.slowQueryLogs = slowQueryLogs;
                        }
                    )
                );
            }

            if (operations.includes(PerformanceAdvisorOperation.SCHEMA_SUGGESTIONS)) {
                performanceAdvisorPromises.push(
                    getSchemaAdvice(this.session.apiClient, projectId, clusterName).then(({ recommendations }) => {
                        data.schemaSuggestions = recommendations;
                    })
                );
            }

            await Promise.all(performanceAdvisorPromises);
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error retrieving performance advisor data: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
            };
        }

        // Format the data as tables
        let formattedOutput = "";
        let totalItems = 0;

        if (data.suggestedIndexes.length > 0) {
            const suggestedIndexesTable = this.formatSuggestedIndexesTable(data.suggestedIndexes);
            formattedOutput += `\n## Suggested Indexes\n${suggestedIndexesTable}\n`;
            totalItems += data.suggestedIndexes.length;
        }

        if (
            data.dropIndexSuggestions.hiddenIndexes.length > 0 ||
            data.dropIndexSuggestions.redundantIndexes.length > 0 ||
            data.dropIndexSuggestions.unusedIndexes.length > 0
        ) {
            const dropIndexesTable = this.formatDropIndexesTable(data.dropIndexSuggestions);
            formattedOutput += `\n## Drop Index Suggestions\n${dropIndexesTable}\n`;
            totalItems +=
                data.dropIndexSuggestions.hiddenIndexes.length +
                data.dropIndexSuggestions.redundantIndexes.length +
                data.dropIndexSuggestions.unusedIndexes.length;
        }

        if (data.slowQueryLogs.length > 0) {
            const slowQueriesTable = this.formatSlowQueriesTable(data.slowQueryLogs);
            formattedOutput += `\n## Slow Query Logs\n${slowQueriesTable}\n`;
            totalItems += data.slowQueryLogs.length;
        }

        if (data.schemaSuggestions.length > 0) {
            const schemaTable = this.formatSchemaSuggestionsTable(data.schemaSuggestions);
            formattedOutput += `\n## Schema Suggestions\n${schemaTable}\n`;
            totalItems += data.schemaSuggestions.length;
        }

        if (totalItems === 0) {
            return {
                content: [{ type: "text", text: "No performance advisor recommendations found." }],
            };
        }

        return {
            content: formatUntrustedData(`Found ${totalItems} performance advisor recommendations`, formattedOutput),
        };
    }
}
