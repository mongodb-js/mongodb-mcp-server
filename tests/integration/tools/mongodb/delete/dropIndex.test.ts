import { describe, beforeEach, it, afterEach, expect, vi, type MockInstance } from "vitest";
import type { Collection } from "mongodb";
import {
    databaseCollectionInvalidArgs,
    databaseCollectionParameters,
    defaultTestConfig,
    getDataFromUntrustedContent,
    getResponseContent,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../../helpers.js";
import {
    describeWithMongoDB,
    waitUntilSearchIndexIsListed,
    waitUntilSearchIsReady,
    type MongoDBIntegrationTestCase,
} from "../mongodbHelpers.js";
import { createMockElicitInput } from "../../../../utils/elicitationMocks.js";
import { Elicitation } from "../../../../../src/elicitation.js";
import type { DropIndexOutput } from "../../../../../src/tools/mongodb/delete/dropIndex.js";

function setupForClassicIndexes(integration: MongoDBIntegrationTestCase): {
    getMoviesCollection: () => Collection;
    getIndexName: () => string;
} {
    let moviesCollection: Collection;
    let indexName: string;
    beforeEach(async () => {
        await integration.connectMcpClient();
        const client = integration.mongoClient();
        moviesCollection = client.db("mflix").collection("movies");
        await moviesCollection.insertMany([
            {
                name: "Movie1",
                year: 1994,
            },
            {
                name: "Movie2",
                year: 2001,
            },
        ]);
        indexName = await moviesCollection.createIndex({ year: 1 });
    });

    afterEach(async () => {
        await moviesCollection.drop();
    });

    return {
        getMoviesCollection: () => moviesCollection,
        getIndexName: () => indexName,
    };
}

function setupForVectorSearchIndexes(integration: MongoDBIntegrationTestCase): {
    getMoviesCollection: () => Collection;
    getSearchIndexName: () => string;
    getVectorIndexName: () => string;
} {
    let moviesCollection: Collection;
    const indexName = "searchIdx";
    const vectorIndexName = "vectorIdx";
    beforeEach(async () => {
        await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        moviesCollection = mongoClient.db("mflix").collection("movies");
        await moviesCollection.insertMany([
            {
                name: "Movie1",
                plot: "This is a horrible movie about a database called BongoDB and how it tried to copy the OG MangoDB.",
                embeddings: [0.1, 0.2, 0.3, 0.4],
            },
        ]);
        await waitUntilSearchIsReady(mongoClient);
        await moviesCollection.createSearchIndex({
            name: indexName,
            definition: { mappings: { fields: { plot: { type: "string" } } } },
            type: "search",
        });
        await moviesCollection.createSearchIndex({
            name: vectorIndexName,
            definition: {
                fields: [{ path: "embeddings", type: "vector", numDimensions: 4, similarity: "euclidean" }],
            },
            type: "vectorSearch",
        });
        await waitUntilSearchIndexIsListed(moviesCollection, indexName);
        await waitUntilSearchIndexIsListed(moviesCollection, vectorIndexName);
    });

    afterEach(async () => {
        // dropping collection also drops the associated search indexes
        await moviesCollection.drop();
    });

    return {
        getMoviesCollection: () => moviesCollection,
        getSearchIndexName: () => indexName,
        getVectorIndexName: () => vectorIndexName,
    };
}

describe.each([{ vectorSearchEnabled: false }, { vectorSearchEnabled: true }])(
    "drop-index tool",
    ({ vectorSearchEnabled }) => {
        describe(`when vector search feature flag is ${vectorSearchEnabled ? "enabled" : "disabled"}`, () => {
            describeWithMongoDB(
                "tool metadata and parameters",
                (integration) => {
                    validateToolMetadata(
                        integration,
                        "drop-index",
                        "Drop an index for the provided database and collection.",
                        "delete",
                        [
                            ...databaseCollectionParameters,
                            {
                                name: "indexName",
                                type: "string",
                                description: "The name of the index to be dropped.",
                                required: true,
                            },
                            vectorSearchEnabled
                                ? {
                                      name: "type",
                                      type: "string",
                                      description:
                                          "The type of index to be deleted. Use 'classic' for standard indexes and 'search' for atlas search and vector search indexes.",
                                      required: true,
                                  }
                                : {
                                      name: "type",
                                      type: "string",
                                      description: "The type of index to be deleted. Is always set to 'classic'.",
                                      required: false,
                                  },
                        ]
                    );

                    const invalidArgsTestCases = vectorSearchEnabled
                        ? [
                              ...databaseCollectionInvalidArgs,
                              { database: "test", collection: "testColl", indexName: null, type: "classic" },
                              { database: "test", collection: "testColl", indexName: undefined, type: "classic" },
                              { database: "test", collection: "testColl", indexName: [], type: "classic" },
                              { database: "test", collection: "testColl", indexName: true, type: "classic" },
                              { database: "test", collection: "testColl", indexName: false, type: "search" },
                              { database: "test", collection: "testColl", indexName: 0, type: "search" },
                              { database: "test", collection: "testColl", indexName: 12, type: "search" },
                              { database: "test", collection: "testColl", indexName: "", type: "search" },
                              // When feature flag is enabled anything other than search and
                              // classic are invalid
                              { database: "test", collection: "testColl", indexName: "goodIndex", type: "anything" },
                          ]
                        : [
                              ...databaseCollectionInvalidArgs,
                              { database: "test", collection: "testColl", indexName: null },
                              { database: "test", collection: "testColl", indexName: undefined },
                              { database: "test", collection: "testColl", indexName: [] },
                              { database: "test", collection: "testColl", indexName: true },
                              { database: "test", collection: "testColl", indexName: false },
                              { database: "test", collection: "testColl", indexName: 0 },
                              { database: "test", collection: "testColl", indexName: 12 },
                              { database: "test", collection: "testColl", indexName: "" },
                              // When feature flag is disabled even "search" is an invalid
                              // argument
                              { database: "test", collection: "testColl", indexName: "", type: "search" },
                          ];

                    validateThrowsForInvalidArguments(integration, "drop-index", invalidArgsTestCases);
                },
                {
                    getUserConfig: () => ({
                        ...defaultTestConfig,
                        previewFeatures: vectorSearchEnabled ? ["search"] : [],
                    }),
                }
            );

            describeWithMongoDB(
                "dropping classic indexes",
                (integration) => {
                    const { getIndexName } = setupForClassicIndexes(integration);
                    describe.each([
                        {
                            database: "mflix",
                            collection: "non-existent",
                        },
                        {
                            database: "non-db",
                            collection: "non-coll",
                        },
                    ])(
                        "when attempting to delete an index from non-existent namespace - $database $collection",
                        ({ database, collection }) => {
                            it("should fail with error", async () => {
                                const response = await integration.mcpClient().callTool({
                                    name: "drop-index",
                                    arguments: vectorSearchEnabled
                                        ? { database, collection, indexName: "non-existent", type: "classic" }
                                        : { database, collection, indexName: "non-existent" },
                                });
                                expect(response.isError).toBe(true);
                                const content = getResponseContent(response.content);
                                expect(content).toEqual(
                                    `Error running drop-index: ns not found ${database}.${collection}`
                                );
                            });
                        }
                    );

                    describe("when attempting to delete an index that does not exist", () => {
                        it("should fail with error", async () => {
                            const response = await integration.mcpClient().callTool({
                                name: "drop-index",
                                arguments: vectorSearchEnabled
                                    ? {
                                          database: "mflix",
                                          collection: "movies",
                                          indexName: "non-existent",
                                          type: "classic",
                                      }
                                    : { database: "mflix", collection: "movies", indexName: "non-existent" },
                            });
                            expect(response.isError).toBe(true);
                            const content = getResponseContent(response.content);
                            expect(content).toEqual(
                                `Error running drop-index: index not found with name [non-existent]`
                            );
                        });
                    });

                    describe("when attempting to delete an index that exists", () => {
                        it("should succeed", async () => {
                            const response = await integration.mcpClient().callTool({
                                name: "drop-index",
                                // The index is created in beforeEach
                                arguments: vectorSearchEnabled
                                    ? {
                                          database: "mflix",
                                          collection: "movies",
                                          indexName: getIndexName(),
                                          type: "classic",
                                      }
                                    : { database: "mflix", collection: "movies", indexName: getIndexName() },
                            });
                            expect(response.isError).toBe(undefined);
                            const content = getResponseContent(response.content);
                            expect(content).toContain(`Successfully dropped the index from the provided namespace.`);
                            const data = getDataFromUntrustedContent(content);
                            expect(JSON.parse(data)).toMatchObject({
                                indexName: getIndexName(),
                                namespace: "mflix.movies",
                            });

                            const structuredContent = response.structuredContent as DropIndexOutput;
                            expect(structuredContent.database).toBe("mflix");
                            expect(structuredContent.collection).toBe("movies");
                            expect(structuredContent.indexName).toBe(getIndexName());
                            expect(structuredContent.dropped).toBe(true);
                        });
                    });
                },
                {
                    getUserConfig: () => ({
                        ...defaultTestConfig,
                        previewFeatures: vectorSearchEnabled ? ["search"] : [],
                    }),
                }
            );

            const mockElicitInput = createMockElicitInput();
            describeWithMongoDB(
                "dropping classic indexes through an elicitation enabled client",
                (integration) => {
                    const { getMoviesCollection, getIndexName } = setupForClassicIndexes(integration);
                    afterEach(() => {
                        mockElicitInput.clear();
                    });

                    it("should ask for confirmation before proceeding with tool call", async () => {
                        expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(2);
                        mockElicitInput.confirmYes();
                        await integration.mcpClient().callTool({
                            name: "drop-index",
                            arguments: vectorSearchEnabled
                                ? {
                                      database: "mflix",
                                      collection: "movies",
                                      indexName: getIndexName(),
                                      type: "classic",
                                  }
                                : { database: "mflix", collection: "movies", indexName: getIndexName() },
                        });
                        expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                        expect(mockElicitInput.mock).toHaveBeenCalledWith({
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            message: expect.stringContaining(
                                "You are about to drop the index named `year_1` from the `mflix.movies` namespace"
                            ),
                            mode: "form",
                            requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                        });
                        expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(1);
                    });

                    it("should not drop the index if the confirmation was not provided", async () => {
                        expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(2);
                        mockElicitInput.confirmNo();
                        await integration.mcpClient().callTool({
                            name: "drop-index",
                            arguments: vectorSearchEnabled
                                ? {
                                      database: "mflix",
                                      collection: "movies",
                                      indexName: getIndexName(),
                                      type: "classic",
                                  }
                                : { database: "mflix", collection: "movies", indexName: getIndexName() },
                        });
                        expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                        expect(mockElicitInput.mock).toHaveBeenCalledWith({
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            message: expect.stringContaining(
                                "You are about to drop the index named `year_1` from the `mflix.movies` namespace"
                            ),
                            mode: "form",
                            requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                        });
                        expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(2);
                    });
                },
                {
                    getUserConfig: () => ({
                        ...defaultTestConfig,
                        previewFeatures: vectorSearchEnabled ? ["search"] : [],
                    }),
                    getMockElicitationInput: () => mockElicitInput,
                }
            );

            describe.skipIf(!vectorSearchEnabled)("dropping vector search indexes", () => {
                describeWithMongoDB(
                    "when connected to MongoDB without search support",
                    (integration) => {
                        it("should fail with appropriate error when invoked", async () => {
                            await integration.connectMcpClient();
                            const response = await integration.mcpClient().callTool({
                                name: "drop-index",
                                arguments: { database: "any", collection: "foo", indexName: "default", type: "search" },
                            });
                            const content = getResponseContent(response.content);
                            expect(response.isError).toBe(true);
                            expect(content).toContain(
                                "The connected MongoDB deployment does not support vector search indexes"
                            );
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, previewFeatures: ["search"] }),
                    }
                );

                describeWithMongoDB(
                    "when connected to MongoDB with search support",
                    (integration) => {
                        const { getSearchIndexName, getVectorIndexName, getMoviesCollection } =
                            setupForVectorSearchIndexes(integration);

                        describe.each([
                            {
                                title: "an index from non-existent database",
                                database: "non-existent-db",
                                collection: "non-existent-coll",
                                indexName: "non-existent-index",
                            },
                            {
                                title: "an index from non-existent collection",
                                database: "mflix",
                                collection: "non-existent-coll",
                                indexName: "non-existent-index",
                            },
                            {
                                title: "a non-existent index",
                                database: "mflix",
                                collection: "movies",
                                indexName: "non-existent-index",
                            },
                        ])("and attempting to delete $title", ({ database, collection, indexName }) => {
                            it("should fail with appropriate error", async () => {
                                const response = await integration.mcpClient().callTool({
                                    name: "drop-index",
                                    arguments: { database, collection, indexName, type: "search" },
                                });
                                expect(response.isError).toBe(true);
                                const content = getResponseContent(response.content);
                                expect(content).toContain("Index does not exist in the provided namespace.");

                                const data = getDataFromUntrustedContent(content);
                                expect(JSON.parse(data)).toMatchObject({
                                    indexName,
                                    namespace: `${database}.${collection}`,
                                });
                            });
                        });

                        describe.each([
                            { description: "search", getIndexName: getSearchIndexName },
                            { description: "vector search", getIndexName: getVectorIndexName },
                        ])("and attempting to delete an existing $description index", ({ getIndexName }) => {
                            it("should succeed in deleting the index", async () => {
                                const indexName = getIndexName();
                                const collection = getMoviesCollection();
                                let indexes = await collection.listSearchIndexes().toArray();
                                expect(indexes.find((idx) => idx.name === indexName)).toBeDefined();

                                const response = await integration.mcpClient().callTool({
                                    name: "drop-index",
                                    arguments: {
                                        database: collection.dbName,
                                        collection: collection.collectionName,
                                        indexName,
                                        type: "search",
                                    },
                                });
                                const content = getResponseContent(response.content);
                                expect(content).toContain(
                                    "Successfully dropped the index from the provided namespace."
                                );

                                const data = getDataFromUntrustedContent(content);
                                expect(JSON.parse(data)).toMatchObject({
                                    indexName,
                                    namespace: "mflix.movies",
                                });

                                const structuredContent = response.structuredContent as DropIndexOutput;
                                expect(structuredContent.database).toBe("mflix");
                                expect(structuredContent.collection).toBe("movies");
                                expect(structuredContent.indexName).toBe(indexName);
                                expect(structuredContent.dropped).toBe(true);

                                indexes = await collection.listSearchIndexes().toArray();
                                expect(indexes.find((idx) => idx.name === indexName)).toBeUndefined();
                            });
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, previewFeatures: ["search"] }),
                        downloadOptions: { search: true },
                    }
                );

                describeWithMongoDB(
                    "when connected to MongoDB with auto-embed index support",
                    (integration) => {
                        const indexName = "auto-embed-index";
                        let collection: Collection;
                        beforeEach(async () => {
                            await integration.connectMcpClient();
                            collection = integration.mongoClient().db(integration.randomDbName()).collection("foo");
                            await collection.insertOne({ plot: "A movie about alien" });
                            await collection.createSearchIndex({
                                type: "vectorSearch",
                                name: indexName,
                                definition: {
                                    fields: [
                                        {
                                            type: "autoEmbed",
                                            path: "plot",
                                            model: "voyage-4-large",
                                            modality: "text",
                                        },
                                    ],
                                },
                            });
                            await waitUntilSearchIndexIsListed(collection, indexName);
                        });

                        it("should succeed in deleting the index", async () => {
                            let indexes = await collection.listSearchIndexes().toArray();
                            expect(indexes.find((idx) => idx.name === indexName)).toBeDefined();

                            const response = await integration.mcpClient().callTool({
                                name: "drop-index",
                                arguments: {
                                    database: collection.dbName,
                                    collection: collection.collectionName,
                                    indexName,
                                    type: "search",
                                },
                            });
                            const content = getResponseContent(response.content);
                            expect(content).toContain("Successfully dropped the index from the provided namespace.");

                            const data = getDataFromUntrustedContent(content);
                            expect(JSON.parse(data)).toMatchObject({
                                indexName,
                                namespace: `${integration.randomDbName()}.foo`,
                            });

                            indexes = await collection.listSearchIndexes().toArray();
                            expect(indexes.find((idx) => idx.name === indexName)).toBeUndefined();
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, previewFeatures: ["search"] }),
                        downloadOptions: {
                            autoEmbed: true,
                            mongotPassword: process.env.MDB_MONGOT_PASSWORD as string,
                            voyageIndexingKey: process.env.MDB_VOYAGE_API_KEY as string,
                            voyageQueryKey: process.env.MDB_VOYAGE_API_KEY as string,
                        },
                    }
                );

                const mockElicitInput = createMockElicitInput();
                describeWithMongoDB(
                    "when invoked via an elicitation enabled client",
                    (integration) => {
                        const { getSearchIndexName: getIndexName } = setupForVectorSearchIndexes(integration);
                        let dropSearchIndexSpy: MockInstance;

                        beforeEach(() => {
                            // Note: Unlike drop-index tool test, we don't test the final state of
                            // indexes because of possible longer wait periods for changes to
                            // reflect, at-times taking >30 seconds.
                            dropSearchIndexSpy = vi.spyOn(
                                integration.mcpServer().session.serviceProvider,
                                "dropSearchIndex"
                            );
                        });

                        afterEach(() => {
                            mockElicitInput.clear();
                        });

                        it("should ask for confirmation before proceeding with tool call", async () => {
                            mockElicitInput.confirmYes();
                            await integration.mcpClient().callTool({
                                name: "drop-index",
                                arguments: {
                                    database: "mflix",
                                    collection: "movies",
                                    indexName: getIndexName(),
                                    type: "search",
                                },
                            });
                            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                            expect(mockElicitInput.mock).toHaveBeenCalledWith({
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                message: expect.stringContaining(
                                    "You are about to drop the search index named `searchIdx` from the `mflix.movies` namespace"
                                ),
                                mode: "form",
                                requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                            });

                            expect(dropSearchIndexSpy).toHaveBeenCalledExactlyOnceWith(
                                "mflix",
                                "movies",
                                getIndexName()
                            );
                        });

                        it("should not drop the index if the confirmation was not provided", async () => {
                            mockElicitInput.confirmNo();
                            await integration.mcpClient().callTool({
                                name: "drop-index",
                                arguments: {
                                    database: "mflix",
                                    collection: "movies",
                                    indexName: getIndexName(),
                                    type: "search",
                                },
                            });
                            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                            expect(mockElicitInput.mock).toHaveBeenCalledWith({
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                message: expect.stringContaining(
                                    "You are about to drop the search index named `searchIdx` from the `mflix.movies` namespace"
                                ),
                                mode: "form",
                                requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                            });
                            expect(dropSearchIndexSpy).not.toHaveBeenCalled();
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, previewFeatures: ["search"] }),
                        downloadOptions: { search: true },
                        getMockElicitationInput: () => mockElicitInput,
                    }
                );
            });
        });
    }
);
