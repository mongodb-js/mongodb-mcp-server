import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType, formatUntrustedData } from "../../tool.js";
import { zEJSON } from "../../args.js";
import { type Document } from "bson";
import { zSupportedEmbeddingParameters } from "../../../common/search/embeddingsProvider.js";
import { ErrorCodes, MongoDBError } from "../../../common/errors.js";
import type { VectorFieldIndexDefinition } from "../../../common/search/vectorSearchEmbeddingsManager.js";

export class InsertManyTool extends MongoDBToolBase {
    public name = "insert-many";
    protected description = "Insert an array of documents into a MongoDB collection";
    protected argsShape = {
        ...DbOperationArgs,
        documents: z
            .array(zEJSON().describe("An individual MongoDB document"))
            .describe(
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany(). For fields that have vector search indexes, you can provide raw text strings that will be automatically converted to embeddings if embeddingParameters is provided."
            ),
        embeddingParameters: zSupportedEmbeddingParameters
            .optional()
            .describe(
                "The embedding model and its parameters to use to generate embeddings for fields that have vector search indexes. When a field has a vector search index and contains a plain text string in the document, embeddings will be automatically generated from that string value. Note to LLM: If unsure which embedding model to use, ask the user before providing one."
            ),
    };
    public operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        documents,
        embeddingParameters,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();

        // Get vector search indexes for the collection
        const vectorIndexes = await this.session.vectorSearchEmbeddingsManager.embeddingsForNamespace({
            database,
            collection,
        });

        // Process documents to replace raw string values with generated embeddings
        documents = await this.replaceRawValuesWithEmbeddingsIfNecessary({
            database,
            collection,
            documents,
            vectorIndexes,
            embeddingParameters,
        });

        const embeddingValidationPromises = documents.map((document) =>
            this.session.vectorSearchEmbeddingsManager.findFieldsWithWrongEmbeddings({ database, collection }, document)
        );
        const embeddingValidationResults = await Promise.all(embeddingValidationPromises);
        const embeddingValidations = new Set(embeddingValidationResults.flat());

        if (embeddingValidations.size > 0) {
            // tell the LLM what happened
            const embeddingValidationMessages = Array.from(embeddingValidations).map(
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

    private async replaceRawValuesWithEmbeddingsIfNecessary({
        database,
        collection,
        documents,
        vectorIndexes,
        embeddingParameters,
    }: {
        database: string;
        collection: string;
        documents: Document[];
        vectorIndexes: VectorFieldIndexDefinition[];
        embeddingParameters?: z.infer<typeof zSupportedEmbeddingParameters>;
    }): Promise<Document[]> {
        // If no vector indexes, return documents as-is
        if (vectorIndexes.length === 0) {
            return documents;
        }

        const processedDocuments: Document[] = [];

        for (let i = 0; i < documents.length; i++) {
            const document = documents[i];
            if (!document) {
                continue;
            }
            const processedDoc = await this.processDocumentForEmbeddings(
                database,
                collection,
                document,
                vectorIndexes,
                embeddingParameters
            );
            processedDocuments.push(processedDoc);
        }

        return processedDocuments;
    }

    private async processDocumentForEmbeddings(
        database: string,
        collection: string,
        document: Document,
        vectorIndexes: VectorFieldIndexDefinition[],
        embeddingParameters?: z.infer<typeof zSupportedEmbeddingParameters>
    ): Promise<Document> {
        // Find all fields in the document that match vector search indexed fields and need embeddings
        const fieldsNeedingEmbeddings: Array<{
            path: string;
            rawValue: string;
            indexDef: VectorFieldIndexDefinition;
        }> = [];

        for (const indexDef of vectorIndexes) {
            // Check if the field exists in the document and is a string (raw text)
            const fieldValue = this.getFieldValue(document, indexDef.path);
            if (typeof fieldValue === "string") {
                fieldsNeedingEmbeddings.push({
                    path: indexDef.path,
                    rawValue: fieldValue,
                    indexDef,
                });
            }
        }

        // If no fields need embeddings, return document as-is
        if (fieldsNeedingEmbeddings.length === 0) {
            return document;
        }

        // Check if embeddingParameters is provided
        if (!embeddingParameters) {
            const fieldPaths = fieldsNeedingEmbeddings.map((f) => f.path).join(", ");
            throw new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                `Fields [${fieldPaths}] have vector search indexes and contain raw text strings. The embeddingParameters parameter is required to generate embeddings for these fields.`
            );
        }

        // Generate embeddings for all fields
        const embeddingsMap = new Map<string, number[]>();

        for (const field of fieldsNeedingEmbeddings) {
            const embeddings = await this.session.vectorSearchEmbeddingsManager.generateEmbeddings({
                database,
                collection,
                path: field.path,
                rawValues: [field.rawValue],
                embeddingParameters,
                inputType: "document",
            });

            if (embeddings.length > 0 && Array.isArray(embeddings[0])) {
                embeddingsMap.set(field.path, embeddings[0] as number[]);
            }
        }

        // Replace raw string values with generated embeddings
        const processedDoc = { ...document };

        for (const field of fieldsNeedingEmbeddings) {
            const embedding = embeddingsMap.get(field.path);
            if (embedding) {
                this.setFieldValue(processedDoc, field.path, embedding);
            }
        }

        return processedDoc;
    }

    private getFieldValue(document: Document, path: string): unknown {
        const parts = path.split(".");
        let current: unknown = document;

        for (const part of parts) {
            if (current && typeof current === "object" && part in current) {
                current = (current as Record<string, unknown>)[part];
            } else {
                return undefined;
            }
        }

        return current;
    }

    private setFieldValue(document: Document, path: string, value: unknown): void {
        const parts = path.split(".");
        let current: Record<string, unknown> = document;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!part) {
                continue;
            }
            if (!(part in current) || typeof current[part] !== "object") {
                current[part] = {};
            }
            current = current[part] as Record<string, unknown>;
        }

        const lastPart = parts[parts.length - 1];
        if (lastPart) {
            current[lastPart] = value;
        }
    }
}
