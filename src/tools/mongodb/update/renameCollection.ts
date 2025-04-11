import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoDBToolBase } from "../mongodbTool.js";
import { ToolArgs, OperationType } from "../../tool.js";

export class RenameCollectionTool extends MongoDBToolBase {
    protected name = "rename-collection";
    protected description = "Renames a collection in a MongoDB database";
    protected argsShape = {
        collection: z.string().describe("Collection name"),
        database: z.string().describe("Database name"),
        newName: z.string().describe("The new name for the collection"),
        dropTarget: z.boolean().optional().default(false).describe("If true, drops the target collection if it exists"),
    };
    protected operationType: OperationType = "update";

    protected async execute({
        database,
        collection,
        newName,
        dropTarget,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const result = await provider.renameCollection(database, collection, newName, {
            dropTarget,
        });

        return {
            content: [
                {
                    text: `Collection \`${collection}\` renamed to \`${result.collectionName}\` in database \`${database}\`.`,
                    type: "text",
                },
            ],
        };
    }
}
