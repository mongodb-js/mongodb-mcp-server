import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";
import { zEJSON } from "../../args.js";

const DeleteManyOutputSchema = {
    database: z.string(),
    collection: z.string(),
    deletedCount: z.number(),
};

export type DeleteManyOutput = z.infer<z.ZodObject<typeof DeleteManyOutputSchema>>;

export class DeleteManyTool extends MongoDBToolBase {
    static toolName = "delete-many";
    public description = "Delete multiple documents from a MongoDB collection";
    public override outputSchema = DeleteManyOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
        filter: zEJSON().optional().describe("The filter to match documents to delete"),
    };
    static operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
        filter,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.deleteMany(database, collection, filter);

        return {
            content: [
                {
                    text: `Deleted ${result.deletedCount} document(s) from "${database}.${collection}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                deletedCount: result.deletedCount,
            },
        };
    }
}
