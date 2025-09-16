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
    formatSuggestedIndexesTable,
    formatDropIndexesTable,
    formatSlowQueriesTable,
    formatSchemaSuggestionsTable,
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
        namespaces: z.array(z.string()).describe("Namespaces to list slow query logs").optional(),
    };

    protected async execute({
        projectId,
        clusterName,
        operations,
        since,
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
                    getSlowQueries(this.session.apiClient, projectId, clusterName, since, namespaces).then(
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
            const suggestedIndexesTable = formatSuggestedIndexesTable(data.suggestedIndexes);
            formattedOutput += `\n## Suggested Indexes\n${suggestedIndexesTable}\n`;
            totalItems += data.suggestedIndexes.length;
        }

        if (
            data.dropIndexSuggestions.hiddenIndexes.length > 0 ||
            data.dropIndexSuggestions.redundantIndexes.length > 0 ||
            data.dropIndexSuggestions.unusedIndexes.length > 0
        ) {
            const dropIndexesTable = formatDropIndexesTable(data.dropIndexSuggestions);
            formattedOutput += `\n## Drop Index Suggestions\n${dropIndexesTable}\n`;
            totalItems +=
                data.dropIndexSuggestions.hiddenIndexes.length +
                data.dropIndexSuggestions.redundantIndexes.length +
                data.dropIndexSuggestions.unusedIndexes.length;
        }

        if (data.slowQueryLogs.length > 0) {
            const slowQueriesTable = formatSlowQueriesTable(data.slowQueryLogs);
            formattedOutput += `\n## Slow Query Logs\n${slowQueriesTable}\n`;
            totalItems += data.slowQueryLogs.length;
        }

        if (data.schemaSuggestions.length > 0) {
            const schemaTable = formatSchemaSuggestionsTable(data.schemaSuggestions);
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
