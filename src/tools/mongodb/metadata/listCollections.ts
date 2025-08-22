import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { formatUntrustedData } from "../../tool.js";

export class ListCollectionsTool extends MongoDBToolBase {
    public name = "list-collections";
    protected description = "List all collections for a given database";
    protected argsShape = {
        database: DbOperationArgs.database,
    };

    public operationType: OperationType = "metadata";

    protected async execute({ database }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const collections = await provider.listCollections(database);

        if (collections.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Found 0 collections for database "${database}". To create a collection, use the "create-collection" tool.`,
                    },
                ],
            };
        }

        return {
            content: formatUntrustedData(
                `Found ${collections.length} collections for database "${database}".`,
                collections.map((collection) => `"${collection.name}"`).join("\n")
            ),
        };
    }
}
