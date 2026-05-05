import { z } from "zod";
import { DBOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";

const CreateCollectionOutputSchema = {
    database: z.string(),
    collection: z.string(),
    created: z.boolean(),
};

export type CreateCollectionOutput = z.infer<z.ZodObject<typeof CreateCollectionOutputSchema>>;

export class CreateCollectionTool extends MongoDBToolBase {
    static toolName = "create-collection";
    public description = "Create a new collection in a MongoDB database";
    public override outputSchema = CreateCollectionOutputSchema;
    public argsShape = {
        ...DBOperationArgs,
        collection: z.string().describe("Name of the collection to create"),
    };
    static operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        await provider.createCollection(database, collection);

        return {
            content: [
                {
                    text: `Collection "${collection}" created in database "${database}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                created: true,
            },
        };
    }
}
