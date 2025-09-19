import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType } from "../../tool.js";
import { zEJSON } from "../../args.js";

export class InsertManyTool extends MongoDBToolBase {
    public name = "insert-many";
    protected description = "Insert an array of documents into a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()"
            ),
    };
    public operationType: OperationType = "create";

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
                    text: `Inserted \`${result.insertedCount}\` document(s) into collection "${collection}"`,
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
