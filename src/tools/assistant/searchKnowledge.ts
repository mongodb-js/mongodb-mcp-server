import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType, formatUntrustedData } from "../tool.js";
import { AssistantToolBase } from "./assistantTool.js";
import { LogId } from "../../common/logger.js";
import { stringify as yamlStringify } from "yaml";
import { ListKnowledgeSourcesToolName } from "./listKnowledgeSources.js";

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
            `A list of one or more data sources to limit the search to. You can specify a specific version of a data source by providing the version label. If not provided, the latest version of all data sources will be searched. Available data sources and their versions can be listed by calling the ${ListKnowledgeSourcesToolName} tool.`
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
