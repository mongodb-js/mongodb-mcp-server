import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolExecutionContext, ToolResult } from "@mongodb-js/mcp-core";
import { IndexDirectionSchema } from "../../mongodbSchemas.js";

const CreateIndexOutputSchema = {
    database: z.string(),
    collection: z.string(),
    indexName: z.string(),
};

export type CreateIndexOutput = z.infer<z.ZodObject<typeof CreateIndexOutputSchema>>;

export class CreateIndexTool extends MongoDBToolBase {
    static toolName = "create-index";
    public description = "Create an index on a MongoDB collection";
    public override outputSchema = CreateIndexOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
        indexName: z.string().describe("Name of the index to create"),
        key: z
            .record(z.string(), IndexDirectionSchema)
            .describe("Document describing the index keys and their direction (1 for ascending, -1 for descending)"),
        unique: z
            .boolean()
            .optional()
            .describe("If true, creates a unique index. Only one document in the collection can have a given value."),
        sparse: z
            .boolean()
            .optional()
            .describe(
                "If true, the index only references documents that have the indexed field. By default, the index references all documents."
            ),
        background: z
            .boolean()
            .optional()
            .describe(
                "If true, the index is created in the background, allowing read and write operations to continue while the index is being built."
            ),
    };
    static operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        indexName,
        key,
        unique,
        sparse,
        background,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        await provider.createIndexes(database, collection, [
            {
                name: indexName,
                key,
                unique,
                sparse,
                background,
            },
        ]);

        return {
            content: [
                {
                    text: `Index "${indexName}" created on collection "${collection}" in database "${database}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                indexName,
            },
        };
    }
}
