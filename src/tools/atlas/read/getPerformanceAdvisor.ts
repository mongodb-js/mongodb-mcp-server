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
} from "../../../common/atlas/performanceAdvisorUtils.js";

const PerformanceAdvisorOperationType = z.enum([
    "suggestedIndexes",
    "dropIndexSuggestions",
    "slowQueryLogs",
    "schemaSuggestions",
]);

export class GetPerformanceAdvisorTool extends AtlasToolBase {
    public name = "atlas-get-performance-advisor";
    protected description =
        "Get MongoDB Atlas performance advisor recommendations, which includes the operations: suggested indexes, drop index suggestions, slow query logs, and schema suggestions";
    public operationType: OperationType = "read";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID to get performance advisor recommendations"),
        clusterName: z.string().describe("Atlas cluster name to get performance advisor recommendations"),
        operations: z
            .array(PerformanceAdvisorOperationType)
            .default(PerformanceAdvisorOperationType.options)
            .describe("Operations to get performance advisor recommendations"),
        since: z.date().describe("Date to get slow query logs since").optional(),
        namespaces: z
            .array(z.string())
            .describe("Namespaces to get slow query logs. Only relevant for the slowQueryLogs operation.")
            .optional(),
    };

    protected async execute({
        projectId,
        clusterName,
        operations,
        since,
        namespaces,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        try {
            const [suggestedIndexesResult, dropIndexSuggestionsResult, slowQueryLogsResult, schemaSuggestionsResult] =
                await Promise.all([
                    operations.includes("suggestedIndexes")
                        ? getSuggestedIndexes(this.session.apiClient, projectId, clusterName)
                        : { suggestedIndexes: [] },
                    operations.includes("dropIndexSuggestions")
                        ? getDropIndexSuggestions(this.session.apiClient, projectId, clusterName)
                        : { hiddenIndexes: [], redundantIndexes: [], unusedIndexes: [] },
                    operations.includes("slowQueryLogs")
                        ? getSlowQueries(this.session.apiClient, projectId, clusterName, since, namespaces)
                        : { slowQueryLogs: [] },
                    operations.includes("schemaSuggestions")
                        ? getSchemaAdvice(this.session.apiClient, projectId, clusterName)
                        : { recommendations: [] },
                ]);

            const performanceAdvisorData = [
                suggestedIndexesResult?.suggestedIndexes?.length > 0
                    ? `## Suggested Indexes\n${JSON.stringify(suggestedIndexesResult.suggestedIndexes)}`
                    : "No suggested indexes found.",
                dropIndexSuggestionsResult
                    ? `## Drop Index Suggestions\n${JSON.stringify(dropIndexSuggestionsResult)}`
                    : "No drop index suggestions found.",
                slowQueryLogsResult?.slowQueryLogs?.length > 0
                    ? `## Slow Query Logs\n${JSON.stringify(slowQueryLogsResult.slowQueryLogs)}`
                    : "No slow query logs found.",
                schemaSuggestionsResult?.recommendations?.length > 0
                    ? `## Schema Suggestions\n${JSON.stringify(schemaSuggestionsResult.recommendations)}`
                    : "No schema suggestions found.",
            ];

            if (performanceAdvisorData.length === 0) {
                return {
                    content: [{ type: "text", text: "No performance advisor recommendations found." }],
                };
            }

            return {
                content: formatUntrustedData("Performance advisor data", performanceAdvisorData.join("\n\n")),
            };
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
    }
}
