import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";

const DropIndexOutputSchema = {
    database: z.string(),
    collection: z.string(),
    indexName: z.string(),
    dropped: z.boolean(),
};

export type DropIndexOutput = z.infer<z.ZodObject<typeof DropIndexOutputSchema>>;

export class DropIndexTool extends MongoDBToolBase {
    static toolName = "drop-index";
    public description = "Drop an index from a MongoDB collection";
    public override outputSchema = DropIndexOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
        indexName: z.string().describe("Name of the index to drop"),
    };
    static operationType: OperationType = "delete";

    protected async execute({
        database,
        collection,
        indexName,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        await provider.dropIndexes(database, collection, [indexName]);

        return {
            content: [
                {
                    text: `Index "${indexName}" dropped from collection "${collection}" in database "${database}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                indexName,
                dropped: true,
            },
        };
    }
}
