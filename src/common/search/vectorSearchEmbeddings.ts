import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { Document } from "bson";

type VectorFieldIndexDefinition = {
    type: "vector";
    path: string;
    numDimensions: number;
    quantization: "none" | "scalar" | "binary";
    similarity: "euclidean" | "cosine" | "dotProduct";
};

type EmbeddingNamespace = "${string}.${string}";
export class VectorSearchEmbeddings {
    private embeddings: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]>;

    constructor() {
        this.embeddings = new Map();
    }

    cleanupEmbeddingsForNamespace({ database, collection }: { database: string; collection: string }): void {
        const embeddingDefKey = `${database}.${collection}` as EmbeddingNamespace;
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
        const embeddingDefKey = `${database}.${collection}` as EmbeddingNamespace;
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

    isVectorFieldIndexDefinition(doc: Document): doc is VectorFieldIndexDefinition {
        return doc["type"] === "vector";
    }
}
