import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { OperationType, ToolArgs, ToolResult } from "../../tool.js";
import { z } from "zod";

const CreateCollectionOutputSchema = {
    database: z.string(),
    collection: z.string(),
    created: z.boolean(),
};

export type CreateCollectionOutput = z.infer<z.ZodObject<typeof CreateCollectionOutputSchema>>;

export class CreateCollectionTool extends MongoDBToolBase {
    static toolName = "create-collection";
    public description =
        "Creates a new collection in a database. If the database doesn't exist, it will be created automatically.";
    public argsShape = DbOperationArgs;
    public override outputSchema = CreateCollectionOutputSchema;

    static operationType: OperationType = "create";

    protected async execute({
        collection,
        database,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        await provider.createCollection(database, collection);

        return {
            content: [
                {
                    type: "text",
                    text: `Collection "${collection}" created in database "${database}".`,
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
