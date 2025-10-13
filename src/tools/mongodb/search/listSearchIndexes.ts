import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { ToolArgs, OperationType } from "../../tool.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { formatUntrustedData } from "../../tool.js";
import { EJSON } from "bson";

export type SearchIndexWithStatus = {
    name: string;
    type: string;
    status: string;
    queryable: boolean;
    latestDefinition: Document;
};

export class ListSearchIndexesTool extends MongoDBToolBase {
    public name = "list-search-indexes";
    protected description = "Describes the search and vector search indexes for a single collection";
    protected argsShape = DbOperationArgs;
    public operationType: OperationType = "metadata";

    protected async execute({ database, collection }: ToolArgs<typeof DbOperationArgs>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const searchIndexes = await ListSearchIndexesTool.getSearchIndexes(provider, database, collection);

        if (searchIndexes.length > 0) {
            return {
                content: formatUntrustedData(
                    `Found ${searchIndexes.length} search and vector search indexes in ${database}.${collection}`,
                    searchIndexes.map((index) => EJSON.stringify(index)).join("\n")
                ),
            };
        } else {
            return {
                content: formatUntrustedData(
                    "Could not retrieve search indexes",
                    `There are no search or vector search indexes in ${database}.${collection}`
                ),
            };
        }
    }

    protected verifyAllowed(): boolean {
        // Only enable this on tests for now.
        return process.env.VITEST === "true";
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof DbOperationArgs>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof Error && "codeName" in error && error.codeName === "SearchNotEnabled") {
            return {
                content: [
                    {
                        text: "This MongoDB cluster does not support Search Indexes. Make sure you are using an Atlas Cluster, either remotely in Atlas or using the Atlas Local image, or your cluster supports MongoDB Search.",
                        type: "text",
                        isError: true,
                    },
                ],
            };
        }
        return super.handleError(error, args);
    }

    static async getSearchIndexes(
        provider: NodeDriverServiceProvider,
        database: string,
        collection: string
    ): Promise<SearchIndexWithStatus[]> {
        const searchIndexes = await provider.getSearchIndexes(database, collection);
        /**
         * Atlas Search index status contains a lot of information that is not relevant for the agent at this stage.
         * Like for example, the status on each of the dedicated nodes. We only care about the main status, if it's
         * queryable and the index name. We are also picking the index definition as it can be used by the agent to
         * understand which fields are available for searching.
         **/
        return searchIndexes.map<SearchIndexWithStatus>((index) => ({
            name: (index["name"] ?? "default") as string,
            type: (index["type"] ?? "UNKNOWN") as string,
            status: (index["status"] ?? "UNKNOWN") as string,
            queryable: (index["queryable"] ?? false) as boolean,
            latestDefinition: index["latestDefinition"] as Document,
        }));
    }
}
