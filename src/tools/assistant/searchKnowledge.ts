import { z } from "zod";
import { type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType, type ToolCategory, formatUntrustedData } from "../tool.js";
import { AssistantToolBase } from "./assistantTool.js";
import { LogId } from "../../common/logger.js";
import { stringify as yamlStringify } from "yaml";

export const SearchKnowledgeToolArgs = {
    query: z
        .string()
        .describe(
            "A natural language query to search for in the MongoDB Assistant knowledge base. This should be a single question or a topic that is relevant to the user's MongoDB use case."
        ),
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
            `A list of one or more data sources to limit the search to. You can specify a specific version of a data source by providing the version label. If not provided, the latest version of all data sources will be searched. Available data sources and their versions can be listed by calling the list-knowledge-sources tool.`
        ),
};

export type SearchKnowledgeResponse = {
    /** A list of search results */
    results: {
        /** The URL of the search result */
        url: string;
        /** The page title of the search result */
        title: string;
        /** The text of the page chunk returned from the search */
        text: string;
        /** Metadata for the search result */
        metadata: {
            /** A list of tags that describe the page */
            tags: string[];
            /** Additional metadata */
            [key: string]: unknown;
        };
    }[];
};

export const SearchKnowledgeToolName = "search-knowledge";

export class SearchKnowledgeTool extends AssistantToolBase {
    static toolName = SearchKnowledgeToolName;
    static category: ToolCategory = "assistant";
    static operationType: OperationType = "read";
    public description =
        "Search for information in the MongoDB Assistant knowledge base. This includes official documentation, curated expert guidance, and other resources provided by MongoDB. Supports filtering by data source and version.";
    public argsShape = {
        ...SearchKnowledgeToolArgs,
    };

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
        const { results } = (await response.json()) as SearchKnowledgeResponse;

        const text = yamlStringify(results);

        return {
            content: formatUntrustedData(
                `Found ${results.length} results in the MongoDB Assistant knowledge base.`,
                text
            ),
        };
    }
}
