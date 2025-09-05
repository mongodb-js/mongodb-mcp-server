import { z } from "zod";
import { AtlasToolBase } from "../atlasTool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import {
    getSuggestedIndexes,
    getDropIndexSuggestions,
    getSchemaAdvice,
    getSlowQueries,
    PerformanceAdvisorOperation,
    type PerformanceAdvisorData,
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
            .describe("Operations to list performance advisor recommendations"),
        since: z.string().describe("Date to list performance advisor recommendations since"),
    };

    protected async execute({
        projectId,
        clusterName,
        operations,
        since,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const data: PerformanceAdvisorData = {
            suggestedIndexes: [],
            dropIndexSuggestions: { hiddenIndexes: [], redundantIndexes: [], unusedIndexes: [] },
            slowQueryLogs: [],
            schemaSuggestions: [],
        };

        // If operations is empty, get all performance advisor recommendations
        // Otherwise, get only the specified operations
        const operationsToExecute = operations.length === 0 ? Object.values(PerformanceAdvisorOperation) : operations;

        try {
            if (operationsToExecute.includes(PerformanceAdvisorOperation.SUGGESTED_INDEXES)) {
                const { suggestedIndexes } = await getSuggestedIndexes(this.session.apiClient, projectId, clusterName);
                data.suggestedIndexes = suggestedIndexes;
            }

            if (operationsToExecute.includes(PerformanceAdvisorOperation.DROP_INDEX_SUGGESTIONS)) {
                const { hiddenIndexes, redundantIndexes, unusedIndexes } = await getDropIndexSuggestions(
                    this.session.apiClient,
                    projectId,
                    clusterName
                );
                data.dropIndexSuggestions = { hiddenIndexes, redundantIndexes, unusedIndexes };
            }

            if (operationsToExecute.includes(PerformanceAdvisorOperation.SLOW_QUERY_LOGS)) {
                const { slowQueryLogs } = await getSlowQueries(this.session.apiClient, projectId, clusterName, since);
                data.slowQueryLogs = slowQueryLogs;
            }

            if (operationsToExecute.includes(PerformanceAdvisorOperation.SCHEMA_SUGGESTIONS)) {
                const { recommendations } = await getSchemaAdvice(this.session.apiClient, projectId, clusterName);
                data.schemaSuggestions = recommendations;
            }
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

        return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
    }
}
