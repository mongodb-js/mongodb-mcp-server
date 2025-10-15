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
    waitUntilSearchIndexIsListed,
    waitUntilSearchManagementServiceIsReady,
} from "../../../helpers.js";
import { describeWithMongoDB, type MongoDBIntegrationTestCase } from "../mongodbHelpers.js";
import { createMockElicitInput } from "../../../../utils/elicitationMocks.js";
import { Elicitation } from "../../../../../src/elicitation.js";

const SEARCH_TIMEOUT = 20_000;

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
    getIndexName: () => string;
} {
    let moviesCollection: Collection;
    const indexName = "searchIdx";
    beforeEach(async ({ signal }) => {
        await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        moviesCollection = mongoClient.db("mflix").collection("movies");
        await moviesCollection.insertMany([
            {
                name: "Movie1",
                plot: "This is a horrible movie about a database called BongoDB and how it tried to copy the OG MangoDB.",
            },
        ]);
        await waitUntilSearchManagementServiceIsReady(moviesCollection, signal);
        await moviesCollection.createSearchIndex({
            name: indexName,
            definition: { mappings: { dynamic: true } },
        });
        await waitUntilSearchIndexIsListed(moviesCollection, indexName, signal);
    });

    afterEach(async () => {
        // dropping collection also drops the associated search indexes
        await moviesCollection.drop();
    });

    return {
        getMoviesCollection: () => moviesCollection,
        getIndexName: () => indexName,
    };
}

describe.each([{ vectorSearchEnabled: false }, { vectorSearchEnabled: true }])(
    "drop-index tool",
    ({ vectorSearchEnabled }) => {
        describe(`when vector search is ${vectorSearchEnabled ? "enabled" : "disabled"}`, () => {
            describeWithMongoDB(
                "tool metadata and parameters",
                (integration) => {
                    validateToolMetadata(
                        integration,
                        "drop-index",
                        "Drop an index for the provided database and collection.",
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
                        voyageApiKey: vectorSearchEnabled ? "test-api-key" : "",
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
                        });
                    });
                },
                {
                    getUserConfig: () => ({
                        ...defaultTestConfig,
                        voyageApiKey: vectorSearchEnabled ? "test-api-key" : "",
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
                                "You are about to drop the `year_1` index from the `mflix.movies` namespace"
                            ),
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
                                "You are about to drop the `year_1` index from the `mflix.movies` namespace"
                            ),
                            requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                        });
                        expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(2);
                    });
                },
                {
                    getUserConfig: () => ({
                        ...defaultTestConfig,
                        voyageApiKey: vectorSearchEnabled ? "test-api-key" : "",
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
                                name: "drop-search-index",
                                arguments: { database: "any", collection: "foo", indexName: "default" },
                            });
                            const content = getResponseContent(response.content);
                            expect(response.isError).toBe(true);
                            expect(content).toEqual(
                                "This MongoDB cluster does not support Search Indexes. Make sure you are using an Atlas Cluster, either remotely in Atlas or using the Atlas Local image, or your cluster supports MongoDB Search."
                            );
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, voyageApiKey: "test-api-key" }),
                    }
                );

                describeWithMongoDB(
                    "when connected to MongoDB with search support",
                    (integration) => {
                        const { getIndexName } = setupForVectorSearchIndexes(integration);

                        describe("and attempting to delete a non-existent index", () => {
                            it("should fail with appropriate error", async () => {
                                const response = await integration.mcpClient().callTool({
                                    name: "drop-search-index",
                                    arguments: { database: "any", collection: "foo", indexName: "non-existent" },
                                });
                                expect(response.isError).toBe(true);
                                const content = getResponseContent(response.content);
                                expect(content).toContain("Index does not exist in the provided namespace.");

                                const data = getDataFromUntrustedContent(content);
                                expect(JSON.parse(data)).toMatchObject({
                                    indexName: "non-existent",
                                    namespace: "any.foo",
                                });
                            });
                        });

                        describe("and attempting to delete an existing index", () => {
                            it("should succeed in deleting the index", { timeout: SEARCH_TIMEOUT }, async () => {
                                const response = await integration.mcpClient().callTool({
                                    name: "drop-search-index",
                                    arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
                                });
                                const content = getResponseContent(response.content);
                                expect(content).toContain(
                                    "Successfully dropped the index from the provided namespace."
                                );

                                const data = getDataFromUntrustedContent(content);
                                expect(JSON.parse(data)).toMatchObject({
                                    indexName: getIndexName(),
                                    namespace: "mflix.movies",
                                });
                            });
                        });
                    },
                    {
                        getUserConfig: () => ({ ...defaultTestConfig, voyageApiKey: "test-api-key" }),
                        downloadOptions: { search: true },
                    }
                );

                const mockElicitInput = createMockElicitInput();
                describeWithMongoDB(
                    "when invoked via an elicitation enabled client",
                    (integration) => {
                        const { getIndexName } = setupForVectorSearchIndexes(integration);
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
                                name: "drop-search-index",
                                arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
                            });
                            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                            expect(mockElicitInput.mock).toHaveBeenCalledWith({
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                message: expect.stringContaining(
                                    "You are about to drop the `searchIdx` index from the `mflix.movies` namespace"
                                ),
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
                                name: "drop-search-index",
                                arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
                            });
                            expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                            expect(mockElicitInput.mock).toHaveBeenCalledWith({
                                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                                message: expect.stringContaining(
                                    "You are about to drop the `searchIdx` index from the `mflix.movies` namespace"
                                ),
                                requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                            });
                            expect(dropSearchIndexSpy).not.toHaveBeenCalled();
                        });
                    },
                    {
                        downloadOptions: { search: true },
                        getMockElicitationInput: () => mockElicitInput,
                    }
                );
            });
        });
    }
);
