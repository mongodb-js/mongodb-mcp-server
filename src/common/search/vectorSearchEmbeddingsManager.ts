import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { BSON, type Document } from "bson";
import type { UserConfig } from "../config.js";
import type { ConnectionManager } from "../connectionManager.js";

export type VectorFieldIndexDefinition = {
    type: "vector";
    path: string;
    numDimensions: number;
    quantization: "none" | "scalar" | "binary";
    similarity: "euclidean" | "cosine" | "dotProduct";
};

export type EmbeddingNamespace = `${string}.${string}`;
export class VectorSearchEmbeddingsManager {
    constructor(
        private readonly config: UserConfig,
        private readonly connectionManager: ConnectionManager,
        private readonly embeddings: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]> = new Map()
    ) {
        connectionManager.events.on("connection-close", () => {
            this.embeddings.clear();
        });
    }

    cleanupEmbeddingsForNamespace({ database, collection }: { database: string; collection: string }): void {
        const embeddingDefKey: EmbeddingNamespace = `${database}.${collection}`;
        this.embeddings.delete(embeddingDefKey);
    }

    async embeddingsForNamespace({
        database,
        collection,
    }: {
        database: string;
        collection: string;
    }): Promise<VectorFieldIndexDefinition[]> {
        const provider = await this.assertAtlasSearchIsAvailable();
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
                .flatMap<Document>((index) => (index.latestDefinition?.fields as Document) ?? [])
                .filter((field) => this.isVectorFieldIndexDefinition(field));

            this.embeddings.set(embeddingDefKey, vectorFields);
            return vectorFields;
        }

        return definition;
    }

    async findFieldsWithWrongEmbeddings(
        {
            database,
            collection,
        }: {
            database: string;
            collection: string;
        },
        document: Document
    ): Promise<VectorFieldIndexDefinition[]> {
        const provider = await this.assertAtlasSearchIsAvailable();
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
        return embeddings.filter((emb) => !this.documentPassesEmbeddingValidation(emb, document));
    }

    private async assertAtlasSearchIsAvailable(): Promise<NodeDriverServiceProvider | null> {
        const connectionState = this.connectionManager.currentConnectionState;
        if (connectionState.tag === "connected") {
            if (await connectionState.isSearchSupported()) {
                return connectionState.serviceProvider;
            }
        }

        return null;
    }

    private isVectorFieldIndexDefinition(doc: Document): doc is VectorFieldIndexDefinition {
        return doc["type"] === "vector";
    }

    private documentPassesEmbeddingValidation(definition: VectorFieldIndexDefinition, document: Document): boolean {
        const fieldPath = definition.path.split(".");
        let fieldRef: unknown = document;

        for (const field of fieldPath) {
            if (fieldRef && typeof fieldRef === "object" && field in fieldRef) {
                fieldRef = (fieldRef as Record<string, unknown>)[field];
            } else {
                return true;
            }
        }

        switch (definition.quantization) {
            // Because quantization is not defined by the use
            // we have to trust them in the format they use.
            case "none":
                return true;
            case "scalar":
            case "binary":
                if (fieldRef instanceof BSON.Binary) {
                    try {
                        const elements = fieldRef.toFloat32Array();
                        return elements.length === definition.numDimensions;
                    } catch {
                        // bits are also supported
                        try {
                            const bits = fieldRef.toBits();
                            return bits.length === definition.numDimensions;
                        } catch {
                            return false;
                        }
                    }
                } else {
                    if (!Array.isArray(fieldRef)) {
                        return false;
                    }

                    if (fieldRef.length !== definition.numDimensions) {
                        return false;
                    }

                    if (!fieldRef.every((e) => this.isANumber(e))) {
                        return false;
                    }
                }

                break;
        }

        return true;
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
