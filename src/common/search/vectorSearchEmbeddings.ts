import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { BSON, type Document } from "bson";

type VectorFieldIndexDefinition = {
    type: "vector";
    path: string;
    numDimensions: number;
    quantization: "none" | "scalar" | "binary";
    similarity: "euclidean" | "cosine" | "dotProduct";
};

export type EmbeddingNamespace = `${string}.${string}`;
export class VectorSearchEmbeddings {
    constructor(private readonly embeddings: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]> = new Map()) {}

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
    }): Promise<VectorFieldIndexDefinition[] | undefined> {
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
        const embeddings = await this.embeddingsForNamespace({ database, collection, provider });

        if (!embeddings) {
            return [];
        }

        return embeddings.filter((emb) => !this.documentPassesEmbeddingValidation(emb, document));
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
            case "scalar":
                if (!Array.isArray(fieldRef)) {
                    return false;
                }

                if (fieldRef.length !== definition.numDimensions) {
                    return false;
                }

                if (typeof fieldRef[0] !== "number") {
                    return false;
                }
                break;
            case "binary":
                if (fieldRef instanceof BSON.Binary) {
                    try {
                        const bits = fieldRef.toBits();
                        return bits.length === definition.numDimensions;
                    } catch {
                        return false;
                    }
                } else {
                    return false;
                }
        }

        return true;
    }
}
