import { CollOperationArgs, connectionScopedArgsShape, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { z } from "zod";

const CreateCollectionOutputSchema = {
    database: z.string(),
    collection: z.string(),
    created: z.boolean(),
};

export type CreateCollectionOutput = z.infer<z.ZodObject<typeof CreateCollectionOutputSchema>>;

const CreateCollectionArgsShapeVariants = connectionScopedArgsShape(CollOperationArgs);

export class CreateCollectionTool extends MongoDBToolBase {
    static toolName = "create-collection";
    public description =
        "Creates a new collection in a database. If the database doesn't exist, it will be created automatically.";
    public argsShape(): typeof CreateCollectionArgsShapeVariants.preconfigured {
        return this.selectConnectionScopedArgsShape(CreateCollectionArgsShapeVariants);
    }
    public override outputSchema(): typeof CreateCollectionOutputSchema {
        return CreateCollectionOutputSchema;
    }

    static operationType: OperationType = "create";

    protected async execute({
        connectionId,
        collection,
        database,
    }: ToolArgs<ReturnType<typeof this.argsShape>>): Promise<ToolResult<ReturnType<typeof this.outputSchema>>> {
        const provider = await this.resolveConnection(connectionId);
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
