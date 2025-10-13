import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CommonArgs } from "../../args.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type OperationType, type ToolArgs } from "../../tool.js";
import { ListSearchIndexesTool } from "../search/listSearchIndexes.js";

export class DropSearchIndexTool extends MongoDBToolBase {
    public name = "drop-search-index";
    protected description = "Drop a search index or vector search index for the provided database and collection.";
    protected argsShape = {
        ...DbOperationArgs,
        indexName: CommonArgs.string()
            .nonempty()
            .describe("The name of the search or vector search index to be dropped."),
    };
    public operationType: OperationType = "delete";

    protected override verifyAllowed(): boolean {
        // Only enable this on tests for now.
        return process.env.VITEST === "true";
    }

    protected override async execute({
        database,
        collection,
        indexName,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const searchIndexes = await ListSearchIndexesTool.getSearchIndexes(provider, database, collection);
        const indexDoesNotExist = !searchIndexes.find((index) => index.name === indexName);
        if (indexDoesNotExist) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Index with name "${indexName}" does not exist in the provided namespace "${database}.${collection}".`,
                    },
                ],
                isError: true,
            };
        }

        await provider.dropSearchIndex(database, collection, indexName);
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully dropped the index with name "${indexName}" from the provided namespace "${database}.${collection}".`,
                },
            ],
        };
    }

    protected getConfirmationMessage({ database, collection, indexName }: ToolArgs<typeof this.argsShape>): string {
        return (
            `You are about to drop the \`${indexName}\` index from the \`${database}.${collection}\` namespace:\n\n` +
            "This operation will permanently remove the index and might affect the performance of queries relying on this index.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
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
}
