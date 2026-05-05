import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";

const DropCollectionOutputSchema = {
    database: z.string(),
    collection: z.string(),
    dropped: z.boolean(),
};

export type DropCollectionOutput = z.infer<z.ZodObject<typeof DropCollectionOutputSchema>>;

export class DropCollectionTool extends MongoDBToolBase {
    static toolName = "drop-collection";
    public description = "Drop a collection from a MongoDB database";
    public override outputSchema = DropCollectionOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
    };
    static operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        await provider.dropCollection(database, collection);

        return {
            content: [
                {
                    text: `Collection "${collection}" dropped from database "${database}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                dropped: true,
            },
        };
    }
}
