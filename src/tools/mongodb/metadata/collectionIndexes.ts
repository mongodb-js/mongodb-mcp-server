import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

type SearchIndexStatus = {
    name: string;
    type: string;
    status: string;
    queryable: boolean;
    latestDefinition: Document;
};

type IndexStatus = {
    name: string;
    key: Document;
};

export class CollectionIndexesTool extends MongoDBToolBase {
    public name = "collection-indexes";
    protected description = "Describe the indexes for a collection";
    protected argsShape = DbOperationArgs;
    public operationType: OperationType = "metadata";

    protected async execute({ database, collection }: ToolArgs<typeof DbOperationArgs>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const indexes = await provider.getIndexes(database, collection);
        const indexDefinitions: IndexStatus[] = indexes.map((index) => ({
            name: index.name as string,
            key: index.key as Document,
        }));

        const searchIndexDefinitions: SearchIndexStatus[] = [];
        if (this.isFeatureEnabled("vectorSearch") && (await this.session.isSearchSupported())) {
            const searchIndexes = await provider.getSearchIndexes(database, collection);
            searchIndexDefinitions.push(...this.extractSearchIndexDetails(searchIndexes));
        }

        return {
            content: [
                ...formatUntrustedData(
                    `Found ${indexDefinitions.length} indexes in the collection "${collection}":`,
                    ...indexDefinitions.map((i) => JSON.stringify(i))
                ),
                ...(searchIndexDefinitions.length > 0
                    ? formatUntrustedData(
                          `Found ${searchIndexDefinitions.length} search and vector search indexes in the collection "${collection}":`,
                          ...searchIndexDefinitions.map((i) => JSON.stringify(i))
                      )
                    : []),
            ],
        };
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof Error && "codeName" in error && error.codeName === "NamespaceNotFound") {
            return {
                content: [
                    {
                        text: `The indexes for "${args.database}.${args.collection}" cannot be determined because the collection does not exist.`,
                        type: "text",
                    },
                ],
                isError: true,
            };
        }

        return super.handleError(error, args);
    }

    /**
     * Atlas Search index status contains a lot of information that is not relevant for the agent at this stage.
     * Like for example, the status on each of the dedicated nodes. We only care about the main status, if it's
     * queryable and the index name. We are also picking the index definition as it can be used by the agent to
     * understand which fields are available for searching.
     **/
    protected extractSearchIndexDetails(indexes: Record<string, unknown>[]): SearchIndexStatus[] {
        return indexes.map((index) => ({
            name: (index["name"] ?? "default") as string,
            type: (index["type"] ?? "UNKNOWN") as string,
            status: (index["status"] ?? "UNKNOWN") as string,
            queryable: (index["queryable"] ?? false) as boolean,
            latestDefinition: index["latestDefinition"] as Document,
        }));
    }
}
