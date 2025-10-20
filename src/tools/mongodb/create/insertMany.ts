import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData } from "../../tool.js";
import { zEJSON } from "../../args.js";

export class InsertManyTool extends MongoDBToolBase {
    public name = "insert-many";
    protected description = "Insert an array of documents into a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()"
            ),
    };
    public operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        const embeddingValidations = new Set(
            ...(await Promise.all(
                documents.flatMap((document) =>
                    this.session.vectorSearchEmbeddingsManager.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        document
                    )
                )
            ))
        );

        if (embeddingValidations.size > 0) {
            // tell the LLM what happened
            const embeddingValidationMessages = [...embeddingValidations].map(
                (validation) =>
                    `- Field ${validation.path} is an embedding with ${validation.expectedNumDimensions} dimensions and ${validation.expectedQuantization}` +
                    ` quantization, and the provided value is not compatible. Actual dimensions: ${validation.actualNumDimensions}, ` +
                    `actual quantization: ${validation.actualQuantization}. Error: ${validation.error}`
            );

            return {
                content: formatUntrustedData(
                    "There were errors when inserting documents. No document was inserted.",
                    ...embeddingValidationMessages
                ),
                isError: true,
            };
        }

        const result = await provider.insertMany(database, collection, documents);
        const content = formatUntrustedData(
            "Documents were inserted successfully.",
            `Inserted \`${result.insertedCount}\` document(s) into ${database}.${collection}.`,
            `Inserted IDs: ${Object.values(result.insertedIds).join(", ")}`
        );
        return {
            content,
        };
    }
}
