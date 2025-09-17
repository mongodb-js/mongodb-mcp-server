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
    type PerformanceAdvisorData,
} from "../../../common/atlas/performanceAdvisorUtils.js";

const PerformanceAdvisorOperationType = z.enum([
    "suggestedIndexes",
    "dropIndexSuggestions",
    "slowQueryLogs",
    "schemaSuggestions",
]);
export class ListPerformanceAdvisorTool extends AtlasToolBase {
    public name = "atlas-list-performance-advisor";
    protected description = "List MongoDB Atlas performance advisor recommendations";
    public operationType: OperationType = "read";
    protected argsShape = {
        projectId: z.string().describe("Atlas project ID to list performance advisor recommendations"),
        clusterName: z.string().describe("Atlas cluster name to list performance advisor recommendations"),
        operations: z
            .array(PerformanceAdvisorOperationType)
            .default(PerformanceAdvisorOperationType.options)
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

            if (operations.includes("suggestedIndexes")) {
                performanceAdvisorPromises.push(
                    getSuggestedIndexes(this.session.apiClient, projectId, clusterName).then(({ suggestedIndexes }) => {
                        data.suggestedIndexes = suggestedIndexes;
                    })
                );
            }

            if (operations.includes("dropIndexSuggestions")) {
                performanceAdvisorPromises.push(
                    getDropIndexSuggestions(this.session.apiClient, projectId, clusterName).then(
                        ({ hiddenIndexes, redundantIndexes, unusedIndexes }) => {
                            data.dropIndexSuggestions = { hiddenIndexes, redundantIndexes, unusedIndexes };
                        }
                    )
                );
            }

            if (operations.includes("slowQueryLogs")) {
                performanceAdvisorPromises.push(
                    getSlowQueries(this.session.apiClient, projectId, clusterName, since, namespaces).then(
                        ({ slowQueryLogs }) => {
                            data.slowQueryLogs = slowQueryLogs;
                        }
                    )
                );
            }

            if (operations.includes("schemaSuggestions")) {
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

        let formattedOutput = "";

        if (data.suggestedIndexes.length > 0) {
            formattedOutput += `\n## Suggested Indexes\n${JSON.stringify(data.suggestedIndexes)}\n`;
        }

        if (
            data.dropIndexSuggestions.hiddenIndexes.length > 0 ||
            data.dropIndexSuggestions.redundantIndexes.length > 0 ||
            data.dropIndexSuggestions.unusedIndexes.length > 0
        ) {
            formattedOutput += `\n## Drop Index Suggestions\n${JSON.stringify(data.dropIndexSuggestions)}\n`;
        }

        if (data.slowQueryLogs.length > 0) {
            formattedOutput += `\n## Slow Query Logs\n${JSON.stringify(data.slowQueryLogs)}\n`;
        }

        if (data.schemaSuggestions.length > 0) {
            formattedOutput += `\n## Schema Suggestions\n${JSON.stringify(data.schemaSuggestions)}\n`;
        }

        if (formattedOutput === "") {
            return {
                content: [{ type: "text", text: "No performance advisor recommendations found." }],
            };
        }

        return {
            content: formatUntrustedData("Performance advisor data", formattedOutput),
        };
    }
}
