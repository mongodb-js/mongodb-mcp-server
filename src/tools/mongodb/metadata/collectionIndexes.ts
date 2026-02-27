import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const CollectionIndexesOutputSchema = {
    classicIndexes: z.array(
        z.object({
            name: z.string(),
            key: z.record(z.unknown()),
        })
    ),
    searchIndexes: z.array(
        z.object({
            name: z.string(),
            type: z.string(),
            status: z.string(),
            queryable: z.boolean(),
            latestDefinition: z.record(z.unknown()),
        })
    ),
    classicIndexesCount: z.number(),
    searchIndexesCount: z.number(),
};

export type CollectionIndexesOutput = z.infer<z.ZodObject<typeof CollectionIndexesOutputSchema>>;

type SearchIndexStatus = CollectionIndexesOutput["searchIndexes"][number];
type IndexStatus = CollectionIndexesOutput["classicIndexes"][number];

export class CollectionIndexesTool extends MongoDBToolBase {
    static toolName = "collection-indexes";
    public description = "Describe the indexes for a collection";
    public argsShape = DbOperationArgs;
    public override outputSchema = CollectionIndexesOutputSchema;
    static operationType: OperationType = "metadata";

    protected async execute({
        database,
        collection,
    }: ToolArgs<typeof DbOperationArgs>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const indexes = await provider.getIndexes(database, collection);
        const classicIndexes: IndexStatus[] = indexes.map((index) => ({
            name: index.name as string,
            key: index.key as Record<string, unknown>,
        }));

        const searchIndexes: SearchIndexStatus[] = [];
        if (this.isFeatureEnabled("search") && (await this.session.isSearchSupported())) {
            const searchIndexDefinitions = await provider.getSearchIndexes(database, collection);
            searchIndexes.push(...this.extractSearchIndexDetails(searchIndexDefinitions));
        }

        return {
            content: [
                ...formatUntrustedData(
                    `Found ${classicIndexes.length} classic indexes in the collection "${collection}":`,
                    JSON.stringify(classicIndexes)
                ),
                ...(searchIndexes.length > 0
                    ? formatUntrustedData(
                          `Found ${searchIndexes.length} search and vector search indexes in the collection "${collection}":`,
                          JSON.stringify(searchIndexes)
                      )
                    : []),
            ],
            structuredContent: {
                classicIndexes,
                searchIndexes,
                classicIndexesCount: classicIndexes.length,
                searchIndexesCount: searchIndexes.length,
            },
        };
    }

    protected async handleError(error: unknown, args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        // >>>>>>> main
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

        return super.handleError(error, args) as ToolResult | Promise<ToolResult>;
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
            latestDefinition: (index["latestDefinition"] ?? {}) as Record<string, unknown>,
        }));
    }
}
