import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoBulkWriteError, type WriteError } from "mongodb";
import { redact } from "mongodb-redact";
import { CollOperationArgs, ConnectionIdArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData, type ToolResult } from "../../tool.js";
import { zEJSON } from "../../args.js";
import { type Document } from "bson";

/** Cap the per-index failure list so a large batch of failures can't blow up the response. */
const MAX_REPORTED_WRITE_ERRORS = 10;

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
        ...ConnectionIdArgs,
        ...CollOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()."
            ),
    };
    public override outputSchema = InsertManyOutputSchema;
    static operationType: OperationType = "create";

    protected async execute({
        connectionId,
        database,
        collection,
        documents,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.resolveConnection(connectionId);

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

    protected override async handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        // A bulk write failure is usually partial: with the driver's default
        // ordered inserts, every document before the first failing index was
        // inserted and everything after it was skipped. The generic handler
        // flattens this to a single message, losing which documents made it in
        // and which failed — report both so the caller can retry precisely.
        if (error instanceof MongoBulkWriteError) {
            const writeErrors: WriteError[] = Array.isArray(error.writeErrors)
                ? (error.writeErrors as WriteError[])
                : [error.writeErrors as WriteError];
            const failedLines = writeErrors
                .slice(0, MAX_REPORTED_WRITE_ERRORS)
                .map(
                    (writeError) =>
                        `- index ${writeError.index} (code ${writeError.code}): ${redact(
                            writeError.errmsg ?? "unknown write error",
                            this.session.keychain.allSecrets
                        )}`
                );
            if (writeErrors.length > MAX_REPORTED_WRITE_ERRORS) {
                failedLines.push(`- ...and ${writeErrors.length - MAX_REPORTED_WRITE_ERRORS} more write error(s)`);
            }

            const description = [
                `Error running ${this.name}: ${writeErrors.length} of ${args.documents.length} document(s) failed to insert into ${args.database}.${args.collection}.`,
                `${error.insertedCount} document(s) were inserted.`,
                "Because inserts are ordered, documents after the first failing index were not attempted.",
                "Fix or remove the failing document(s) and retry with only the documents that were not inserted.",
            ].join(" ");

            return {
                content: formatUntrustedData(description, ...failedLines),
                isError: true,
            };
        }

        return super.handleError(error, args);
    }
}
