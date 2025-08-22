import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export class CollectionIndexesTool extends MongoDBToolBase {
    public name = "collection-indexes";
    protected description = "Describe the indexes for a collection";
    protected argsShape = DbOperationArgs;
    public operationType: OperationType = "read";

    protected async execute({ database, collection }: ToolArgs<typeof DbOperationArgs>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const indexes = await provider.getIndexes(database, collection);

        return {
            content: formatUntrustedData(
                `Found ${indexes.length} indexes in the collection "${collection}":`,
                indexes.length > 0
                    ? indexes
                          .map((index) => `Name: "${index.name}", definition: ${JSON.stringify(index.key)}`)
                          .join("\n")
                    : undefined
            ),
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
            };
        }

        return super.handleError(error, args);
    }
}
