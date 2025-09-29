import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolArgs, OperationType } from "../tool.js";
import { AssistantToolBase } from "./assistantTool.js";
import { LogId } from "../../common/logger.js";

export const SearchKnowledgeToolArgs = {
    query: z.string().describe("A natural language query to search for in the knowledge base"),
    limit: z.number().min(1).max(100).optional().default(5).describe("The maximum number of results to return"),
    dataSources: z
        .array(
            z.object({
                name: z.string().describe("The name of the data source"),
                versionLabel: z.string().optional().describe("The version label of the data source"),
            })
        )
        .optional()
        .describe(
            "A list of one or more data sources to search in. You can specify a specific version of a data source by providing the version label. If not provided, the latest version of all data sources will be searched."
        ),
};

export const knowledgeChunkSchema = z
    .object({
        url: z.string().describe("The URL of the search result"),
        title: z.string().describe("Title of the search result"),
        text: z.string().describe("Chunk text"),
        metadata: z
            .object({
                tags: z.array(z.string()).describe("The tags of the source"),
            })
            .passthrough(),
    })
    .passthrough();

export const searchResponseSchema = z.object({
    results: z.array(knowledgeChunkSchema).describe("A list of search results"),
});

export class SearchKnowledgeTool extends AssistantToolBase {
    public name = "search-knowledge";
    protected description = "Search for information in the MongoDB Assistant knowledge base";
    protected argsShape = {
        ...SearchKnowledgeToolArgs,
    };
    public operationType: OperationType = "read";

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const response = await this.callAssistantApi({
            method: "POST",
            endpoint: "content/search",
            body: args,
        });
        if (!response.ok) {
            const message = `Failed to search knowledge base: ${response.statusText}`;
            this.session.logger.debug({
                id: LogId.assistantSearchKnowledgeError,
                context: "assistant-search-knowledge",
                message,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: message,
                    },
                ],
                isError: true,
            };
        }
        const { results } = searchResponseSchema.parse(await response.json());
        return {
            content: results.map(({ text, metadata }) => ({
                type: "text",
                text,
                _meta: {
                    ...metadata,
                },
            })),
        };
    }
}
