import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { BSON, type Document } from "bson";
import type { UserConfig } from "../config.js";

export type VectorFieldIndexDefinition = {
    type: "vector";
    path: string;
    numDimensions: number;
    quantization: "none" | "scalar" | "binary";
    similarity: "euclidean" | "cosine" | "dotProduct";
};

export type EmbeddingNamespace = `${string}.${string}`;
export class VectorSearchEmbeddings {
    constructor(
        private readonly config: UserConfig,
        private readonly embeddings: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]> = new Map(),
        private readonly atlasSearchStatus: Map<string, boolean> = new Map()
    ) {}

    cleanupEmbeddingsForNamespace({ database, collection }: { database: string; collection: string }): void {
        const embeddingDefKey: EmbeddingNamespace = `${database}.${collection}`;
        this.embeddings.delete(embeddingDefKey);
    }

    async embeddingsForNamespace({
        database,
        collection,
        provider,
    }: {
        database: string;
        collection: string;
        provider: NodeDriverServiceProvider;
    }): Promise<VectorFieldIndexDefinition[]> {
        if (!(await this.isAtlasSearchAvailable(provider))) {
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
        } else {
            return definition;
        }
    }

    async findFieldsWithWrongEmbeddings(
        {
            database,
            collection,
            provider,
        }: {
            database: string;
            collection: string;
            provider: NodeDriverServiceProvider;
        },
        document: Document
    ): Promise<VectorFieldIndexDefinition[]> {
        if (!(await this.isAtlasSearchAvailable(provider))) {
            return [];
        }

        // While we can do our best effort to ensure that the embedding validation is correct
        // based on https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-quantization/
        // it's a complex process so we will also give the user the ability to disable this validation
        if (this.config.disableEmbeddingsValidation) {
            return [];
        }

        const embeddings = await this.embeddingsForNamespace({ database, collection, provider });
        return embeddings.filter((emb) => !this.documentPassesEmbeddingValidation(emb, document));
    }

    async isAtlasSearchAvailable(provider: NodeDriverServiceProvider): Promise<boolean> {
        const providerUri = provider.getURI();
        if (!providerUri) {
            // no URI? can't be cached
            return await this.canListAtlasSearchIndexes(provider);
        }

        if (this.atlasSearchStatus.has(providerUri)) {
            // has should ensure that get is always defined
            return this.atlasSearchStatus.get(providerUri) ?? false;
        }

        const availability = await this.canListAtlasSearchIndexes(provider);
        this.atlasSearchStatus.set(providerUri, availability);
        return availability;
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

                    if (typeof fieldRef[0] !== "number") {
                        return false;
                    }
                }

                break;
        }

        return true;
    }

    private async canListAtlasSearchIndexes(provider: NodeDriverServiceProvider): Promise<boolean> {
        try {
            await provider.getSearchIndexes("test", "test");
            return true;
        } catch {
            return false;
        }
    }
}
