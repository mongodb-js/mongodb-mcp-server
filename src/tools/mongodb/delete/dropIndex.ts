import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { CommonArgs } from "../../args.js";

export class DropIndexTool extends MongoDBToolBase {
    public name = "drop-index";
    protected description = "Drop an index for the provided database and collection.";
    protected argsShape = {
        ...DbOperationArgs,
        indexName: CommonArgs.string().nonempty().describe("The name of the index to be dropped."),
    };
    public operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
        indexName,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const result = await provider.runCommand(database, {
            dropIndexes: collection,
            index: indexName,
        });

        return {
            content: [
                {
                    text: `${result.ok ? "Successfully dropped" : "Failed to drop"} the index with name "${indexName}" from the provided namespace "${database}.${collection}".`,
                    type: "text",
                },
            ],
            isError: result.ok ? undefined : true,
        };
    }

    protected getConfirmationMessage({ database, collection, indexName }: ToolArgs<typeof this.argsShape>): string {
        return (
            `You are about to drop the \`${indexName}\` index from the \`${database}.${collection}\` namespace:\n\n` +
            "This operation will permanently remove the index and might affect the performance of queries relying on this index.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
    }
}
