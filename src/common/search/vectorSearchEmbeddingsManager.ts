import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { BSON, type Document } from "bson";
import type { UserConfig } from "../config.js";
import type { ConnectionManager } from "../connectionManager.js";
import z from "zod";
import { ErrorCodes, MongoDBError } from "../errors.js";
import { getEmbeddingsProvider } from "./embeddingsProvider.js";
import type { EmbeddingParameters } from "../../tools/mongodb/mongodbSchemas.js";
import { formatUntrustedData } from "../../tools/tool.js";
import type { Similarity } from "../schemas.js";
import type { SupportedEmbeddingParameters } from "../../tools/mongodb/mongodbSchemas.js";

export const quantizationEnum = z.enum(["none", "scalar", "binary"]);
export type Quantization = z.infer<typeof quantizationEnum>;

export type VectorFieldIndexDefinition = {
    type: "vector";
    path: string;
    numDimensions: number;
    quantization: Quantization;
    similarity: Similarity;
};

export type VectorFieldValidationError = {
    path: string;
    expectedNumDimensions: number;
    expectedQuantization: Quantization;
    actualNumDimensions: number | "unknown";
    actualQuantization: Quantization | "unknown";
    error: "dimension-mismatch" | "quantization-mismatch" | "not-a-vector" | "not-numeric";
};

export type EmbeddingNamespace = `${string}.${string}`;
export class VectorSearchEmbeddingsManager {
    constructor(
        private readonly config: UserConfig,
        private readonly connectionManager: ConnectionManager,
        private readonly embeddings: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]> = new Map(),
        private readonly embeddingsProvider: typeof getEmbeddingsProvider = getEmbeddingsProvider
    ) {
        connectionManager.events.on("connection-close", () => {
            this.embeddings.clear();
        });
    }

    cleanupEmbeddingsForNamespace({ database, collection }: { database: string; collection: string }): void {
        const embeddingDefKey: EmbeddingNamespace = `${database}.${collection}`;
        this.embeddings.delete(embeddingDefKey);
    }

    async indexExists({
        database,
        collection,
        indexName,
    }: {
        database: string;
        collection: string;
        indexName: string;
    }): Promise<boolean> {
        const provider = await this.atlasSearchEnabledProvider();
        if (!provider) {
            return false;
        }

        const searchIndexesWithName = await provider.getSearchIndexes(database, collection, indexName);

        return searchIndexesWithName.length >= 1;
    }

    async embeddingsForNamespace({
        database,
        collection,
    }: {
        database: string;
        collection: string;
    }): Promise<VectorFieldIndexDefinition[]> {
        const provider = await this.atlasSearchEnabledProvider();
        if (!provider) {
            return [];
        }

        // We only need the embeddings for validation now, so don't query them if
        // validation is disabled.
        if (this.config.disableEmbeddingsValidation) {
            return [];
        }

        const embeddingDefKey: EmbeddingNamespace = `${database}.${collection}`;
        const definition = this.embeddings.get(embeddingDefKey);

        if (!definition) {
            const allSearchIndexes = await provider.getSearchIndexes(database, collection);
            const vectorSearchIndexes = allSearchIndexes.filter((index) => index.type === "vectorSearch");
            const vectorFields = vectorSearchIndexes
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                .flatMap<Document>((index) => (index.latestDefinition?.fields as Document[]) ?? [])
                .filter((field) => this.isVectorFieldIndexDefinition(field));

            this.embeddings.set(embeddingDefKey, vectorFields);
            return vectorFields;
        }

        return definition;
    }

    async assertFieldsHaveCorrectEmbeddings(
        { database, collection }: { database: string; collection: string },
        documents: Document[]
    ): Promise<void> {
        const embeddingValidationResults = (
            await Promise.all(
                documents.map((document) => this.findFieldsWithWrongEmbeddings({ database, collection }, document))
            )
        ).flat();

        if (embeddingValidationResults.length > 0) {
            const embeddingValidationMessages = embeddingValidationResults.map(
                (validation) =>
                    `- Field ${validation.path} is an embedding with ${validation.expectedNumDimensions} dimensions and ${validation.expectedQuantization}` +
                    ` quantization, and the provided value is not compatible. Actual dimensions: ${validation.actualNumDimensions}, ` +
                    `actual quantization: ${validation.actualQuantization}. Error: ${validation.error}`
            );

            throw new MongoDBError(
                ErrorCodes.AtlasVectorSearchInvalidQuery,
                formatUntrustedData("", ...embeddingValidationMessages)
                    .map(({ text }) => text)
                    .join("\n")
            );
        }
    }

    public async findFieldsWithWrongEmbeddings(
        {
            database,
            collection,
        }: {
            database: string;
            collection: string;
        },
        document: Document
    ): Promise<VectorFieldValidationError[]> {
        const provider = await this.atlasSearchEnabledProvider();
        if (!provider) {
            return [];
        }

        // While we can do our best effort to ensure that the embedding validation is correct
        // based on https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-quantization/
        // it's a complex process so we will also give the user the ability to disable this validation
        if (this.config.disableEmbeddingsValidation) {
            return [];
        }

        const embeddings = await this.embeddingsForNamespace({ database, collection });
        return embeddings
            .map((emb) => this.getValidationErrorForDocument(emb, document))
            .filter((e) => e !== undefined);
    }

    private async atlasSearchEnabledProvider(): Promise<NodeDriverServiceProvider | null> {
        const connectionState = this.connectionManager.currentConnectionState;
        if (connectionState.tag === "connected" && (await connectionState.isSearchSupported())) {
            return connectionState.serviceProvider;
        }

        return null;
    }

    private isVectorFieldIndexDefinition(doc: Document): doc is VectorFieldIndexDefinition {
        return doc["type"] === "vector";
    }

    private getValidationErrorForDocument(
        definition: VectorFieldIndexDefinition,
        document: Document
    ): VectorFieldValidationError | undefined {
        const fieldPath = definition.path.split(".");
        let fieldRef: unknown = document;

        const constructError = (
            details: Partial<Pick<VectorFieldValidationError, "error" | "actualNumDimensions" | "actualQuantization">>
        ): VectorFieldValidationError => ({
            path: definition.path,
            expectedNumDimensions: definition.numDimensions,
            expectedQuantization: definition.quantization,
            actualNumDimensions: details.actualNumDimensions ?? "unknown",
            actualQuantization: details.actualQuantization ?? "unknown",
            error: details.error ?? "not-a-vector",
        });

        for (const field of fieldPath) {
            if (fieldRef && typeof fieldRef === "object" && field in fieldRef) {
                fieldRef = (fieldRef as Record<string, unknown>)[field];
            } else {
                return undefined;
            }
        }

        switch (definition.quantization) {
            // Because quantization is not defined by the user
            // we have to trust them in the format they use.
            case "none":
                return undefined;
            case "scalar":
            case "binary":
                if (fieldRef instanceof BSON.Binary) {
                    try {
                        const elements = fieldRef.toFloat32Array();
                        if (elements.length !== definition.numDimensions) {
                            return constructError({
                                actualNumDimensions: elements.length,
                                actualQuantization: "binary",
                                error: "dimension-mismatch",
                            });
                        }

                        return undefined;
                    } catch {
                        // bits are also supported
                        try {
                            const bits = fieldRef.toBits();
                            if (bits.length !== definition.numDimensions) {
                                return constructError({
                                    actualNumDimensions: bits.length,
                                    actualQuantization: "binary",
                                    error: "dimension-mismatch",
                                });
                            }

                            return undefined;
                        } catch {
                            return constructError({
                                actualQuantization: "binary",
                                error: "not-a-vector",
                            });
                        }
                    }
                } else {
                    if (!Array.isArray(fieldRef)) {
                        return constructError({
                            error: "not-a-vector",
                        });
                    }

                    if (fieldRef.length !== definition.numDimensions) {
                        return constructError({
                            actualNumDimensions: fieldRef.length,
                            actualQuantization: "scalar",
                            error: "dimension-mismatch",
                        });
                    }

                    if (!fieldRef.every((e) => this.isANumber(e))) {
                        return constructError({
                            actualNumDimensions: fieldRef.length,
                            actualQuantization: "scalar",
                            error: "not-numeric",
                        });
                    }
                }

                break;
        }

        return undefined;
    }

    public async assertVectorSearchIndexExists({
        database,
        collection,
        path,
    }: {
        database: string;
        collection: string;
        path: string;
    }): Promise<void> {
        const embeddingInfoForCollection = await this.embeddingsForNamespace({ database, collection });
        const embeddingInfoForPath = embeddingInfoForCollection.find((definition) => definition.path === path);
        if (!embeddingInfoForPath) {
            throw new MongoDBError(
                ErrorCodes.AtlasVectorSearchIndexNotFound,
                `No Vector Search index found for path "${path}" in namespace "${database}.${collection}"`
            );
        }
    }

    public async generateEmbeddings({
        rawValues,
        embeddingParameters,
        inputType,
    }: {
        rawValues: string[];
        embeddingParameters: SupportedEmbeddingParameters;
        inputType: EmbeddingParameters["inputType"];
    }): Promise<unknown[][]> {
        const provider = await this.atlasSearchEnabledProvider();
        if (!provider) {
            throw new MongoDBError(
                ErrorCodes.AtlasSearchNotSupported,
                "Atlas Search is not supported in this cluster."
            );
        }

        const embeddingsProvider = this.embeddingsProvider(this.config);

        if (!embeddingsProvider) {
            throw new MongoDBError(ErrorCodes.NoEmbeddingsProviderConfigured, "No embeddings provider configured.");
        }

        if (this.config.disableEmbeddingsValidation) {
            return await embeddingsProvider.embed(embeddingParameters.model, rawValues, {
                inputType,
                ...embeddingParameters,
            });
        }

        return await embeddingsProvider.embed(embeddingParameters.model, rawValues, {
            inputType,
            ...embeddingParameters,
        });
    }

    private isANumber(value: unknown): boolean {
        if (typeof value === "number") {
            return true;
        }

        if (
            value instanceof BSON.Int32 ||
            value instanceof BSON.Decimal128 ||
            value instanceof BSON.Double ||
            value instanceof BSON.Long
        ) {
            return true;
        }

        return false;
    }
}
