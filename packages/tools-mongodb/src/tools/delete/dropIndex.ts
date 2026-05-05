import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";

const DropIndexOutputSchema = {
    database: z.string(),
    collection: z.string(),
    indexName: z.string(),
    dropped: z.boolean(),
};

export type DropIndexOutput = z.infer<z.ZodObject<typeof DropIndexOutputSchema>>;

export class DropIndexTool extends MongoDBToolBase {
    static toolName = "drop-index";
    public description = "Drop an index for the provided database and collection.";
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

        await provider.runCommandWithCheck(database, {
            dropIndexes: collection,
            index: indexName,
        });

        return {
            content: [
                {
                    text: `Successfully dropped the index from the provided namespace.`,
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
