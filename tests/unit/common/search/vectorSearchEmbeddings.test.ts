import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import { VectorSearchEmbeddings } from "../../../../src/common/search/vectorSearchEmbeddings.js";
import type { EmbeddingNamespace } from "../../../../src/common/search/vectorSearchEmbeddings.js";
import { BSON } from "bson";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";

type MockedServiceProvider = NodeDriverServiceProvider & {
    getSearchIndexes: MockedFunction<NodeDriverServiceProvider["getSearchIndexes"]>;
};

describe("VectorSearchEmbeddings", () => {
    const database = "my" as const;
    const collection = "collection" as const;
    const mapKey = `${database}.${collection}` as EmbeddingNamespace;

    const provider: MockedServiceProvider = {
        getSearchIndexes: vi.fn(),
    } as unknown as MockedServiceProvider;

    beforeEach(() => {
        provider.getSearchIndexes.mockReset();
    });

    describe("embedding retrieval", () => {
        describe("when the embeddings have not been cached", () => {
            beforeEach(() => {
                provider.getSearchIndexes.mockImplementation(() => {
                    return Promise.resolve([
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
            });

            it("retrieves the list of vector search indexes for that collection from the cluster", async () => {
                const embeddings = new VectorSearchEmbeddings();
                const result = await embeddings.embeddingsForNamespace({ database, collection, provider });

                expect(result).toContainEqual({
                    type: "vector",
                    path: "plot_embedding",
                    numDimensions: 1536,
                    similarity: "euclidean",
                });
            });

            it("ignores any other type of index", async () => {
                const embeddings = new VectorSearchEmbeddings();
                const result = await embeddings.embeddingsForNamespace({ database, collection, provider });

                expect(result?.filter((emb) => emb.type !== "vector")).toHaveLength(0);
            });
        });
    });

    describe("embedding validation", () => {
        it("when there are no embeddings, all documents are valid", async () => {
            const embeddings = new VectorSearchEmbeddings(new Map([[mapKey, []]]));
            const result = await embeddings.findFieldsWithWrongEmbeddings(
                { database, collection, provider },
                { field: "yay" }
            );

            expect(result).toHaveLength(0);
        });

        describe("when there are embeddings", () => {
            const embeddings = new VectorSearchEmbeddings(
                new Map([
                    [
                        mapKey,
                        [
                            {
                                type: "vector",
                                path: "embedding_field",
                                numDimensions: 8,
                                quantization: "none",
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
                                quantization: "none",
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
                ])
            );

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

            it("documents inserting the field with correct dimensions, but wrong quantization are invalid", async () => {
                const result = await embeddings.findFieldsWithWrongEmbeddings(
                    { database, collection, provider },
                    { embedding_field_binary: [1, 2, 3, 4, 5, 6, 7, 8] }
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
