import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { formatUntrustedData } from "../../tool.js";
import { EJSON } from "bson";

export type SearchIndexStatus = {
    name: string;
    type: "search" | "vectorSearch";
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
        await this.ensureSearchIsSupported();

        const indexes = await provider.getSearchIndexes(database, collection);
        const trimmedIndexDefinitions = this.pickRelevantInformation(indexes);

        if (trimmedIndexDefinitions.length > 0) {
            return {
                content: formatUntrustedData(
                    `Found ${trimmedIndexDefinitions.length} search and vector search indexes in ${database}.${collection}`,
                    ...trimmedIndexDefinitions.map((index) => EJSON.stringify(index))
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

    /**
     * Atlas Search index status contains a lot of information that is not relevant for the agent at this stage.
     * Like for example, the status on each of the dedicated nodes. We only care about the main status, if it's
     * queryable and the index name. We are also picking the index definition as it can be used by the agent to
     * understand which fields are available for searching.
     **/
    protected pickRelevantInformation(indexes: Record<string, unknown>[]): SearchIndexStatus[] {
        return indexes.map((index) => ({
            name: (index["name"] ?? "default") as string,
            type: (index["type"] ?? "UNKNOWN") as "search" | "vectorSearch",
            status: (index["status"] ?? "UNKNOWN") as string,
            queryable: (index["queryable"] ?? false) as boolean,
            latestDefinition: index["latestDefinition"] as Document,
        }));
    }
}
