import { z } from "zod";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData, type ToolResult } from "../../tool.js";
import { zEJSON } from "../../args.js";
import { type Document } from "bson";

const InsertManyOutputSchema = {
    database: z.string(),
    collection: z.string(),
    insertedCount: z.number(),
    insertedIds: z.array(z.unknown()),
};

export type InsertManyOutput = z.infer<z.ZodObject<typeof InsertManyOutputSchema>>;

export class InsertManyTool extends MongoDBToolBase {
    static toolName = "insert-many";
    public description =
        "Insert an array of documents into a MongoDB collection. If the list of documents is above com.mongodb/maxRequestPayloadBytes, consider inserting them in batches.";
    public argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()."
            ),
    };
    public override outputSchema = InsertManyOutputSchema;
    static operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        const result = await provider.insertMany(database, collection, documents as Document[]);
        const insertedIds = Object.values(result.insertedIds);
        const content = formatUntrustedData(
            "Documents were inserted successfully.",
            `Inserted \`${result.insertedCount}\` document(s) into ${database}.${collection}.`,
            `Inserted IDs: ${insertedIds.join(", ")}`
        );
        return {
            content,
            structuredContent: {
                database,
                collection,
                insertedCount: result.insertedCount,
                insertedIds,
            },
        };
    }
}
