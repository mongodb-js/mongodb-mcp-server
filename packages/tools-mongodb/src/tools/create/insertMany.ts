import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "@mongodb-js/mcp-core";
import { zEJSON } from "../../args.js";
import { EJSON } from "bson";

const InsertManyOutputSchema = {
    database: z.string(),
    collection: z.string(),
    insertedCount: z.number(),
    insertedIds: z.array(z.string()),
};

export type InsertManyOutput = z.infer<z.ZodObject<typeof InsertManyOutputSchema>>;

export class InsertManyTool extends MongoDBToolBase {
    static toolName = "insert-many";
    public description = "Insert multiple documents into a MongoDB collection";
    public override outputSchema = InsertManyOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
        documents: z.array(zEJSON()).describe("An array of documents to insert into the collection"),
    };
    static operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.insertMany(database, collection, documents);

        return {
            content: [
                {
                    text: `Inserted ${result.insertedCount} document(s) into "${database}.${collection}".`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                insertedCount: result.insertedCount,
                insertedIds: Object.values(result.insertedIds).map((id: unknown) => EJSON.stringify(id)),
            },
        };
    }
}
