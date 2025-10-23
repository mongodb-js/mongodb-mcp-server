import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MockedFunction } from "vitest";
import { VectorSearchEmbeddingsManager } from "../../../../src/common/search/vectorSearchEmbeddingsManager.js";
import type {
    EmbeddingNamespace,
    VectorFieldIndexDefinition,
    VectorFieldValidationError,
} from "../../../../src/common/search/vectorSearchEmbeddingsManager.js";
import { BSON } from "bson";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { ConnectionManager, UserConfig } from "../../../../src/lib.js";
import { ConnectionStateConnected } from "../../../../src/common/connectionManager.js";
import type { InsertOneResult } from "mongodb";
import type { DropDatabaseResult } from "@mongosh/service-provider-node-driver/lib/node-driver-service-provider.js";
import EventEmitter from "events";
import {
    type EmbeddingParameters,
    type EmbeddingsProvider,
    type getEmbeddingsProvider,
} from "../../../../src/common/search/embeddingsProvider.js";

type MockedServiceProvider = NodeDriverServiceProvider & {
    getSearchIndexes: MockedFunction<NodeDriverServiceProvider["getSearchIndexes"]>;
    createSearchIndexes: MockedFunction<NodeDriverServiceProvider["createSearchIndexes"]>;
    insertOne: MockedFunction<NodeDriverServiceProvider["insertOne"]>;
    dropDatabase: MockedFunction<NodeDriverServiceProvider["dropDatabase"]>;
};

type MockedConnectionManager = ConnectionManager & {
    currentConnectionState: ConnectionStateConnected;
};

type MockedEmbeddingsProvider = EmbeddingsProvider<string, EmbeddingParameters> & {
    embed: MockedFunction<EmbeddingsProvider<string, EmbeddingParameters>["embed"]>;
};

const database = "my" as const;
const collection = "collection" as const;
const mapKey = `${database}.${collection}` as EmbeddingNamespace;

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

describe("VectorSearchEmbeddingsManager", () => {
    const embeddingValidationEnabled: UserConfig = { disableEmbeddingsValidation: false } as UserConfig;
    const embeddingValidationDisabled: UserConfig = { disableEmbeddingsValidation: true } as UserConfig;
    const eventEmitter = new EventEmitter();

    const provider: MockedServiceProvider = {
        getSearchIndexes: vi.fn(),
        createSearchIndexes: vi.fn(),
        insertOne: vi.fn(),
        dropDatabase: vi.fn(),
        getURI: () => "mongodb://my-test",
    } as unknown as MockedServiceProvider;

    const embeddingsProvider: MockedEmbeddingsProvider = {
        embed: vi.fn(),
    };

    const getMockedEmbeddingsProvider: typeof getEmbeddingsProvider = () => {
        return embeddingsProvider;
    };

    const connectionManager: MockedConnectionManager = {
        currentConnectionState: new ConnectionStateConnected(provider),
        events: eventEmitter,
    } as unknown as MockedConnectionManager;

    beforeEach(() => {
        provider.getSearchIndexes.mockReset();
        embeddingsProvider.embed.mockReset();

        provider.createSearchIndexes.mockResolvedValue([]);
        provider.insertOne.mockResolvedValue({} as unknown as InsertOneResult);
        provider.dropDatabase.mockResolvedValue({} as unknown as DropDatabaseResult);
    });

    describe("embeddings cache", () => {
        it("the connection is closed gets cleared", async () => {
            const configCopy = new Map(embeddingConfig);
            const embeddings = new VectorSearchEmbeddingsManager(
                embeddingValidationEnabled,
                connectionManager,
                configCopy
            );

            eventEmitter.emit("connection-close");
            void embeddings; // we don't need to call it, it's already subscribed by the constructor

            const isEmpty = await vi.waitFor(() => {
                if (configCopy.size > 0) {
                    throw new Error("Didn't consume the 'connection-close' event yet");
                }
                return true;
            });

            expect(isEmpty).toBeTruthy();
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
                const embeddings = new VectorSearchEmbeddingsManager(embeddingValidationEnabled, connectionManager);
                const result = await embeddings.embeddingsForNamespace({ database, collection });

                expect(result).toContainEqual({
                    type: "vector",
                    path: "plot_embedding",
                    numDimensions: 1536,
                    similarity: "euclidean",
                });
            });

            it("ignores any other type of index", async () => {
                const embeddings = new VectorSearchEmbeddingsManager(embeddingValidationEnabled, connectionManager);
                const result = await embeddings.embeddingsForNamespace({ database, collection });

                expect(result?.filter((emb) => emb.type !== "vector")).toHaveLength(0);
            });

            it("embeddings are cached in memory", async () => {
                const embeddings = new VectorSearchEmbeddingsManager(embeddingValidationEnabled, connectionManager);
                const result1 = await embeddings.embeddingsForNamespace({ database, collection });
                const result2 = await embeddings.embeddingsForNamespace({ database, collection });

                expect(provider.getSearchIndexes).toHaveBeenCalledTimes(1);
                expect(result1).toEqual(result2);
            });

            it("embeddings are cached in memory until cleaned up", async () => {
                const embeddings = new VectorSearchEmbeddingsManager(embeddingValidationEnabled, connectionManager);
                const result1 = await embeddings.embeddingsForNamespace({ database, collection });
                embeddings.cleanupEmbeddingsForNamespace({ database, collection });
                const result2 = await embeddings.embeddingsForNamespace({ database, collection });

                expect(provider.getSearchIndexes).toHaveBeenCalledTimes(2);
                expect(result1).toEqual(result2);
            });
        });
    });

    describe("embedding validation", () => {
        it("when there are no embeddings, all documents are valid", async () => {
            const embeddings = new VectorSearchEmbeddingsManager(
                embeddingValidationEnabled,
                connectionManager,
                new Map([[mapKey, []]])
            );
            const result = await embeddings.findFieldsWithWrongEmbeddings({ database, collection }, { field: "yay" });

            expect(result).toHaveLength(0);
        });

        describe("when there are embeddings", () => {
            describe("when the validation is disabled", () => {
                let embeddings: VectorSearchEmbeddingsManager;

                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddingsManager(
                        embeddingValidationDisabled,
                        connectionManager,
                        embeddingConfig
                    );
                });

                it("documents inserting the field with wrong type are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: "some text" }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with wrong dimensions are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: [1, 2, 3] }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions, but wrong type are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: ["1", "2", "3", "4", "5", "6", "7", "8"] }
                    );

                    expect(result).toHaveLength(0);
                });
            });

            describe("when the validation is enabled", () => {
                let embeddings: VectorSearchEmbeddingsManager;

                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddingsManager(
                        embeddingValidationEnabled,
                        connectionManager,
                        embeddingConfig
                    );
                });

                it("documents not inserting the field with embeddings are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { field: "yay" }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with wrong type are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: "some text" }
                    );

                    expect(result).toHaveLength(1);
                });

                it("documents inserting the field with wrong dimensions are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: [1, 2, 3] }
                    );

                    expect(result).toHaveLength(1);
                    const expectedError: VectorFieldValidationError = {
                        actualNumDimensions: 3,
                        actualQuantization: "scalar",
                        error: "dimension-mismatch",
                        expectedNumDimensions: 8,
                        expectedQuantization: "scalar",
                        path: "embedding_field",
                    };
                    expect(result[0]).toEqual(expectedError);
                });

                it("documents inserting the field with correct dimensions, but wrong type are invalid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: ["1", "2", "3", "4", "5", "6", "7", "8"] }
                    );

                    expect(result).toHaveLength(1);
                    const expectedError: VectorFieldValidationError = {
                        actualNumDimensions: 8,
                        actualQuantization: "scalar",
                        error: "not-numeric",
                        expectedNumDimensions: 8,
                        expectedQuantization: "scalar",
                        path: "embedding_field",
                    };

                    expect(result[0]).toEqual(expectedError);
                });

                it("documents inserting the field with correct dimensions and quantization in binary are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field_binary: BSON.Binary.fromBits([0, 0, 0, 0, 0, 0, 0, 0]) }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { embedding_field: [1, 2, 3, 4, 5, 6, 7, 8] }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid also on nested fields", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { a: { nasty: { scalar: { field: [1, 2, 3, 4, 5, 6, 7, 8] } } } }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid also on nested fields with bson int", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { a: { nasty: { scalar: { field: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => new BSON.Int32(i)) } } } }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid also on nested fields with bson long", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { a: { nasty: { scalar: { field: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => new BSON.Long(i)) } } } }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in scalar/none are valid also on nested fields with bson double", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { a: { nasty: { scalar: { field: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => new BSON.Double(i)) } } } }
                    );

                    expect(result).toHaveLength(0);
                });

                it("documents inserting the field with correct dimensions and quantization in binary are valid also on nested fields", async () => {
                    const result = await embeddings.findFieldsWithWrongEmbeddings(
                        { database, collection },
                        { a: { nasty: { binary: { field: BSON.Binary.fromBits([0, 0, 0, 0, 0, 0, 0, 0]) } } } }
                    );

                    expect(result).toHaveLength(0);
                });
            });
        });
    });

    describe("generate embeddings", () => {
        const embeddingToGenerate = {
            database: "mydb",
            collection: "mycoll",
            path: "embedding_field",
            rawValues: ["oops"],
            embeddingParameters: { model: "voyage-3-large", outputDimension: 1024, outputDType: "float" } as const,
            inputType: "query" as const,
        };

        let embeddings: VectorSearchEmbeddingsManager;

        beforeEach(() => {
            embeddings = new VectorSearchEmbeddingsManager(
                embeddingValidationDisabled,
                connectionManager,
                new Map(),
                getMockedEmbeddingsProvider
            );
        });

        describe("when atlas search is not available", () => {
            beforeEach(() => {
                embeddings = new VectorSearchEmbeddingsManager(
                    embeddingValidationEnabled,
                    connectionManager,
                    new Map(),
                    getMockedEmbeddingsProvider
                );

                provider.getSearchIndexes.mockRejectedValue(new Error());
            });

            it("throws an exception", async () => {
                await expect(embeddings.generateEmbeddings(embeddingToGenerate)).rejects.toThrowError();
            });
        });

        describe("when atlas search is available", () => {
            describe("when embedding validation is disabled", () => {
                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddingsManager(
                        embeddingValidationDisabled,
                        connectionManager,
                        new Map(),
                        getMockedEmbeddingsProvider
                    );
                });

                describe("when no index is available for path", () => {
                    it("returns the embeddings as is", async () => {
                        embeddingsProvider.embed.mockResolvedValue([[0xc0ffee]]);

                        const [result] = await embeddings.generateEmbeddings(embeddingToGenerate);
                        expect(result).toEqual([0xc0ffee]);
                    });
                });
            });

            describe("when embedding validation is enabled", () => {
                beforeEach(() => {
                    embeddings = new VectorSearchEmbeddingsManager(
                        embeddingValidationEnabled,
                        connectionManager,
                        new Map(),
                        getMockedEmbeddingsProvider
                    );
                });

                describe("when no index is available for path", () => {
                    it("throws an exception", async () => {
                        await expect(embeddings.generateEmbeddings(embeddingToGenerate)).rejects.toThrowError();
                    });
                });

                describe("when index is available on path", () => {
                    beforeEach(() => {
                        provider.getSearchIndexes.mockResolvedValue([
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
                                            path: embeddingToGenerate.path,
                                            numDimensions: 1024,
                                            similarity: "euclidean",
                                        },
                                        { type: "filter", path: "genres" },
                                        { type: "filter", path: "year" },
                                    ],
                                },
                            },
                        ]);
                    });

                    describe("when embedding validation is disabled", () => {
                        it("returns the embeddings as is", async () => {
                            embeddingsProvider.embed.mockResolvedValue([[0xc0ffee]]);

                            const [result] = await embeddings.generateEmbeddings(embeddingToGenerate);
                            expect(result).toEqual([0xc0ffee]);
                        });
                    });
                });
            });
        });
    });
});
