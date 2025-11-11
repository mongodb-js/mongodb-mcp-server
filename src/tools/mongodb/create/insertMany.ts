import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData } from "../../tool.js";
import { zEJSON } from "../../args.js";
import { type Document } from "bson";
import { zSupportedEmbeddingParameters } from "../mongodbSchemas.js";
import { ErrorCodes, MongoDBError } from "../../../common/errors.js";

const zSupportedEmbeddingParametersWithInput = zSupportedEmbeddingParameters.extend({
    input: z
        .array(z.object({}).passthrough())
        .describe(
            "Array of objects with vector search index fields as keys (in dot notation) and the raw text values to generate embeddings for as values. The index of each object corresponds to the index of the document in the documents array."
        ),
});

export class InsertManyTool extends MongoDBToolBase {
    public name = "insert-many";
    protected description = "Insert an array of documents into a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()."
            ),
        ...(this.isFeatureEnabled("vectorSearch")
            ? {
                  embeddingParameters: zSupportedEmbeddingParametersWithInput
                      .optional()
                      .describe(
                          "The embedding model and its parameters to use to generate embeddings for fields with vector search indexes. Note to LLM: If unsure which embedding model to use, ask the user before providing one."
                      ),
              }
            : {}),
    };
    public operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
        embeddingParameters: providedEmbeddingParameters,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        const embeddingParameters = this.isFeatureEnabled("vectorSearch")
            ? (providedEmbeddingParameters as z.infer<typeof zSupportedEmbeddingParametersWithInput>)
            : undefined;

        // Process documents to replace raw string values with generated embeddings
        documents = await this.replaceRawValuesWithEmbeddingsIfNecessary({
            database,
            collection,
            documents,
            embeddingParameters,
        });

        await this.session.vectorSearchEmbeddingsManager.assertFieldsHaveCorrectEmbeddings(
            { database, collection },
            documents
        );

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

    private async replaceRawValuesWithEmbeddingsIfNecessary({
        database,
        collection,
        documents,
        embeddingParameters,
    }: {
        database: string;
        collection: string;
        documents: Document[];
        embeddingParameters?: z.infer<typeof zSupportedEmbeddingParametersWithInput>;
    }): Promise<Document[]> {
        // If no embedding parameters or no input specified, return documents as-is
        if (!embeddingParameters?.input || embeddingParameters.input.length === 0) {
            return documents;
        }

        // Get vector search indexes for the collection
        const vectorIndexes = await this.session.vectorSearchEmbeddingsManager.embeddingsForNamespace({
            database,
            collection,
        });

        // Ensure for inputted fields, the vector search index exists.
        for (const input of embeddingParameters.input) {
            for (const fieldPath of Object.keys(input)) {
                if (!vectorIndexes.some((index) => index.path === fieldPath)) {
                    throw new MongoDBError(
                        ErrorCodes.AtlasVectorSearchInvalidQuery,
                        `Field '${fieldPath}' does not have a vector search index in collection ${database}.${collection}. Only fields with vector search indexes can have embeddings generated.`
                    );
                }
            }
        }

        // We make one call to generate embeddings for all documents at once to avoid making too many API calls.
        const flattenedEmbeddingsInput = embeddingParameters.input.flatMap((documentInput, index) =>
            Object.entries(documentInput).map(([fieldPath, rawTextValue]) => ({
                fieldPath,
                rawTextValue,
                documentIndex: index,
            }))
        );

        const generatedEmbeddings = await this.session.vectorSearchEmbeddingsManager.generateEmbeddings({
            rawValues: flattenedEmbeddingsInput.map(({ rawTextValue }) => rawTextValue) as string[],
            embeddingParameters,
            inputType: "document",
        });

        const processedDocuments: Document[] = [...documents];

        for (const [index, { fieldPath, documentIndex }] of flattenedEmbeddingsInput.entries()) {
            if (!processedDocuments[documentIndex]) {
                throw new MongoDBError(ErrorCodes.Unexpected, `Document at index ${documentIndex} does not exist.`);
            }
            // Ensure no nested fields are present in the field path.
            this.deleteFieldPath(processedDocuments[documentIndex], fieldPath);
            processedDocuments[documentIndex][fieldPath] = generatedEmbeddings[index];
        }

        return processedDocuments;
    }

    // Delete a specified field path from a document using dot notation.
    private deleteFieldPath(document: Record<string, unknown>, fieldPath: string): void {
        const parts = fieldPath.split(".");
        let current: Record<string, unknown> = document;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const key = part as keyof typeof current;
            if (!current[key]) {
                return;
            } else if (i === parts.length - 1) {
                delete current[key];
            } else {
                current = current[key] as Record<string, unknown>;
            }
        }
    }
}
