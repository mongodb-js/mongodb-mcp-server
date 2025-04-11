import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "./mongodbTool.js";
import { ToolArgs, OperationType } from "../tool.js";
import { IndexDirection } from "mongodb";

export class CreateIndexTool extends MongoDBToolBase {
    protected name = "create-index";
    protected description = "Create an index for a collection";
    protected argsShape = {
        ...DbOperationArgs,
        keys: z.record(z.string(), z.custom<IndexDirection>()).describe("The index definition"),
    };

    protected operationType: OperationType = "create";

    protected async execute({ database, collection, keys }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const indexes = await provider.createIndexes(database, collection, [
            {
                key: keys,
            },
        ]);

        return {
            content: [
                {
                    text: `Created the index \`${indexes[0]}\``,
                    type: "text",
                },
            ],
        };
    }
}
