import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import { VectorSearchEmbeddings } from "../../../../src/common/search/vectorSearchEmbeddings.js";
import type {
    EmbeddingNamespace,
    VectorFieldIndexDefinition,
} from "../../../../src/common/search/vectorSearchEmbeddings.js";
import { BSON } from "bson";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { UserConfig } from "../../../../src/lib.js";

type MockedServiceProvider = NodeDriverServiceProvider & {
    getSearchIndexes: MockedFunction<NodeDriverServiceProvider["getSearchIndexes"]>;
};

describe("VectorSearchEmbeddings", () => {
    const embeddingValidationEnabled: UserConfig = { disableEmbeddingsValidation: false } as UserConfig;
    const embeddingValidationDisabled: UserConfig = { disableEmbeddingsValidation: true } as UserConfig;

    const database = "my" as const;
    const collection = "collection" as const;
    const mapKey = `${database}.${collection}` as EmbeddingNamespace;

    const provider: MockedServiceProvider = {
        getSearchIndexes: vi.fn(),
        getURI: () => "mongodb://my-test",
    } as unknown as MockedServiceProvider;

    beforeEach(() => {
        provider.getSearchIndexes.mockReset();
    });

    describe("atlas search availability", () => {
        describe("when it is available", () => {
            const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
            beforeEach(() => {
                provider.getSearchIndexes.mockResolvedValue([]);
            });

            it("returns true", async () => {
                expect(await embeddings.isAtlasSearchAvailable(provider)).toBeTruthy();
            });
        });

        describe("when it is not available", () => {
            const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
            beforeEach(() => {
                provider.getSearchIndexes.mockRejectedValue(new Error("Atlas Search not available"));
            });

            it("returns false", async () => {
                expect(await embeddings.isAtlasSearchAvailable(provider)).toBeFalsy();
            });
        });
    });

    describe("embedding retrieval", () => {
        describe("when the embeddings have not been cached", () => {
            beforeEach(() => {
                provider.getSearchIndexes.mockResolvedValue([
                    {
                        id: "65e8c766d0450e3e7ab9855f",
                        name: "search-test",
                        type: "search",
                        status: "READY",
                        queryable: true,
                        latestDefinition: { dynamic: true },
                    },
                    {
                        id: "65e8c766d0450e3e7ab9855f",
                        name: "vector-search-test",
                        type: "vectorSearch",
                        status: "READY",
                        queryable: true,
                        latestDefinition: {
                            fields: [
                                {
                                    type: "vector",
                                    path: "plot_embedding",
                                    numDimensions: 1536,
                                    similarity: "euclidean",
                                },
                                { type: "filter", path: "genres" },
                                { type: "filter", path: "year" },
                            ],
                        },
                    },
                ]);
            });

            it("retrieves the list of vector search indexes for that collection from the cluster", async () => {
                const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
                const result = await embeddings.embeddingsForNamespace({ database, collection, provider });

                expect(result).toContainEqual({
                    type: "vector",
                    path: "plot_embedding",
                    numDimensions: 1536,
                    similarity: "euclidean",
                });
            });

            it("ignores any other type of index", async () => {
                const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
                const result = await embeddings.embeddingsForNamespace({ database, collection, provider });

                expect(result?.filter((emb) => emb.type !== "vector")).toHaveLength(0);
            });

            it("embeddings are cached in memory", async () => {
                const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
                const result1 = await embeddings.embeddingsForNamespace({ database, collection, provider });
                const result2 = await embeddings.embeddingsForNamespace({ database, collection, provider });

                // 1 call to check if search is available, another for retrieving the embedding
                expect(provider.getSearchIndexes).toHaveBeenCalledTimes(2);
                expect(result1).toEqual(result2);
            });

            it("embeddings are cached in memory until cleaned up", async () => {
                const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled);
                const result1 = await embeddings.embeddingsForNamespace({ database, collection, provider });
                embeddings.cleanupEmbeddingsForNamespace({ database, collection });
                const result2 = await embeddings.embeddingsForNamespace({ database, collection, provider });

                // 1 call to check if search is available, another 2 for retrieving the embeddings
                expect(provider.getSearchIndexes).toHaveBeenCalledTimes(3);
                expect(result1).toEqual(result2);
            });
        });
    });

    describe("embedding validation", () => {
        it("when there are no embeddings, all documents are valid", async () => {
            const embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled, new Map([[mapKey, []]]));
            const result = await embeddings.findFieldsWithWrongEmbeddings(
                { database, collection, provider },
                { field: "yay" }
            );

            expect(result).toHaveLength(0);
        });

        describe("when there are embeddings", () => {
            const embeddingConfig: Map<EmbeddingNamespace, VectorFieldIndexDefinition[]> = new Map([
                [
                    mapKey,
                    [
                        {
                            type: "vector",
                            path: "embedding_field",
                            numDimensions: 8,
                            quantization: "scalar",
                            similarity: "euclidean",
                        },
                        {
                            type: "vector",
                            path: "embedding_field_binary",
                            numDimensions: 8,
                            quantization: "binary",
                            similarity: "euclidean",
                        },
                        {
                            type: "vector",
                            path: "a.nasty.scalar.field",
                            numDimensions: 8,
                            quantization: "scalar",
                            similarity: "euclidean",
                        },
                        {
                            type: "vector",
                            path: "a.nasty.binary.field",
                            numDimensions: 8,
                            quantization: "binary",
                            similarity: "euclidean",
                        },
                    ],
                ],
            ]);

            describe("when the validation is disabled", () => {
                let embeddings: VectorSearchEmbeddings;

                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddings(embeddingValidationDisabled, embeddingConfig);
                });

                it("documents inserting the field with wrong type are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: "some text" }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with wrong dimensions are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: [1, 2, 3] }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions, but wrong type are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: ["1", "2", "3", "4", "5", "6", "7", "8"] }
                    );

                    expect(result).toHaveLength(0);
                });
            });

            describe("when the validation is enabled", () => {
                let embeddings: VectorSearchEmbeddings;

                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddings(embeddingValidationEnabled, embeddingConfig);
                });

                it("documents not inserting the field with embeddings are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { field: "yay" }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with wrong type are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: "some text" }
                    );

                    expect(result).toHaveLength(1);
                });

                it("documents inserting the field with wrong dimensions are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: [1, 2, 3] }
                    );

                    expect(result).toHaveLength(1);
                });

                it("documents inserting the field with correct dimensions, but wrong type are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: ["1", "2", "3", "4", "5", "6", "7", "8"] }
                    );

                    expect(result).toHaveLength(1);
                });

                it("documents inserting the field with correct dimensions and quantization in binary are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field_binary: BSON.Binary.fromBits([0, 0, 0, 0, 0, 0, 0, 0]) }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { embedding_field: [1, 2, 3, 4, 5, 6, 7, 8] }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid also on nested fields", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { a: { nasty: { scalar: { field: [1, 2, 3, 4, 5, 6, 7, 8] } } } }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in binary are valid also on nested fields", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection, provider },
                        { a: { nasty: { binary: { field: BSON.Binary.fromBits([0, 0, 0, 0, 0, 0, 0, 0]) } } } }
                    );

                    expect(result).toHaveLength(0);
                });
            });
        });
    });
});
