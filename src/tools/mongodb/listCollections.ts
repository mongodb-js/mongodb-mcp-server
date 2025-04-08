import { z } from "zod";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoDBToolBase } from "./mongodbTool.js";
import { ToolArgs } from "../tool.js";

const argsShape = {
    database: z.string().describe("Database name"),
};

export class ListCollectionsTool extends MongoDBToolBase<typeof argsShape> {
    protected name = "list-collections";
    protected description = "List all collections for a given database";
    protected argsShape = argsShape;

    protected async execute({ database }: ToolArgs<typeof argsShape>): Promise<CallToolResult> {
        const provider = this.ensureConnected();
        const collections = await provider.listCollections(database);

        return {
            content: collections.map((collection) => {
                return {
                    text: `Name: ${collection.name}`,
                    type: "text",
                };
            }),
        };
    }
}
