import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export function collectionIndexesResponse({
    database,
    collection,
    indexes = [],
    namespaceNotFound,
}: {
    database: string;
    collection: string;
    indexes?: { name: string; key: string }[];
    namespaceNotFound?: boolean;
}): CallToolResult {
    if (namespaceNotFound) {
        return {
            content: [
                {
                    text: `The indexes for "${database}.${collection}" cannot be determined because the collection does not exist.`,
                    type: "text",
                },
            ],
        };
    }

    return {
        content: [
            {
                text: `Found ${indexes.length} indexes in the collection "${collection}":`,
                type: "text",
            },
            ...(indexes.map((indexDefinition) => {
                return {
                    text: `Name "${indexDefinition.name}", definition: ${JSON.stringify(indexDefinition.key)}`,
                    type: "text",
                };
            }) as { text: string; type: "text" }[]),
        ],
    };
}

export class CollectionIndexesTool extends MongoDBToolBase {
    protected name = "collection-indexes";
    protected description = "Describe the indexes for a collection";
    protected argsShape = DbOperationArgs;
    protected operationType: OperationType = "read";

    protected async execute({ database, collection }: ToolArgs<typeof DbOperationArgs>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const indexes = await provider.getIndexes(database, collection);
        return collectionIndexesResponse({
            database,
            collection,
            indexes: indexes.map((index) => ({
                name: `${index.name}`,
                key: JSON.stringify(index.key),
            })),
        });
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (error instanceof Error && "codeName" in error && error.codeName === "NamespaceNotFound") {
            return collectionIndexesResponse({
                database: args.database,
                collection: args.collection,
                namespaceNotFound: true,
            });
        }

        return super.handleError(error, args);
    }
}
