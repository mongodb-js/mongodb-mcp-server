import z from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData, FeatureFlags } from "../../tool.js";

export class DropIndexTool extends MongoDBToolBase {
    public name = "drop-index";
    protected description = "Drop an index for the provided database and collection.";
    protected argsShape = {
        ...DbOperationArgs,
        indexName: z.string().nonempty().describe("The name of the index to be dropped."),
    };
    public operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
        indexName,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const existingIndex = (await provider.getIndexes(database, collection)).find((idx) => idx.name === indexName);
        if (existingIndex) {
            const result = await provider.runCommand(database, {
                dropIndexes: collection,
                index: indexName,
            });

            return {
                content: formatUntrustedData(
                    `${result.ok ? "Successfully dropped" : "Failed to drop"} the index from the provided namespace.`,
                    JSON.stringify({
                        indexName,
                        namespace: `${database}.${collection}`,
                    })
                ),
                isError: result.ok ? undefined : true,
            };
        }

        if (this.isFeatureFlagEnabled(FeatureFlags.VectorSearch) && (await this.session.isSearchSupported())) {
            const existingSearchIndex = (await provider.getSearchIndexes(database, collection, indexName))[0];
            if (existingSearchIndex) {
                await provider.dropSearchIndex(database, collection, indexName);
                return {
                    content: formatUntrustedData(
                        "Successfully dropped the index from the provided namespace.",
                        JSON.stringify({
                            indexName,
                            namespace: `${database}.${collection}`,
                        })
                    ),
                };
            }
        }

        return {
            content: formatUntrustedData(
                "Index does not exist in the provided namespace.",
                JSON.stringify({ indexName, namespace: `${database}.${collection}` })
            ),
            isError: true,
        };
    }

    protected getConfirmationMessage({ database, collection, indexName }: ToolArgs<typeof this.argsShape>): string {
        return (
            `You are about to drop the index named \`${indexName}\` from the \`${database}.${collection}\` namespace:\n\n` +
            "This operation will permanently remove the index and might affect the performance of queries relying on this index.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
    }
}
