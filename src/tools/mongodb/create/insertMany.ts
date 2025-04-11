import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class InsertManyTool extends MongoDBToolBase {
    protected name = "insert-many";
    protected description = "Insert an array of documents into a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(z.object({}).passthrough().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()"
            ),
    };
    protected operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const result = await provider.insertMany(database, collection, documents);

        return {
            content: [
                {
                    text: `Inserted \`${result.insertedCount}\` documents into collection \`${collection}\``,
                    type: "text",
                },
                {
                    text: `Inserted IDs: ${Object.values(result.insertedIds).join(", ")}`,
                    type: "text",
                },
            ],
        };
    }
}
