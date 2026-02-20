import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";
import { z } from "zod";

const DropCollectionOutputSchema = {
    database: z.string(),
    collection: z.string(),
    dropped: z.boolean(),
};

export type DropCollectionOutput = z.infer<z.ZodObject<typeof DropCollectionOutputSchema>>;

export class DropCollectionTool extends MongoDBToolBase {
    static toolName = "drop-collection";
    public description =
        "Removes a collection or view from the database. The method also removes any indexes associated with the dropped collection.";
    public argsShape = {
        ...DbOperationArgs,
    };
    public override outputSchema = DropCollectionOutputSchema;
    static operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();
        const result = await provider.dropCollection(database, collection);

        return {
            content: [
                {
                    text: `${result ? "Successfully dropped" : "Failed to drop"} collection "${collection}" from database "${database}"`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                dropped: result,
            },
        };
    }

    protected getConfirmationMessage({ database, collection }: ToolArgs<typeof this.argsShape>): string {
        return (
            `You are about to drop the \`${collection}\` collection from the \`${database}\` database:\n\n` +
            "This operation will permanently remove the collection and all its data, including indexes.\n\n" +
            "**Do you confirm the execution of the action?**"
        );
    }
}
