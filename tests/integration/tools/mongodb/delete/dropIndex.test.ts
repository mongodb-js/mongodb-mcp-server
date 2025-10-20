import { describe, beforeEach, it, afterEach, expect, vi, type MockInstance } from "vitest";
import type { Collection } from "mongodb";
import {
    databaseCollectionInvalidArgs,
    defaultTestConfig,
    getDataFromUntrustedContent,
    getResponseContent,
    validateThrowsForInvalidArguments,
} from "../../../helpers.js";
import {
    describeWithMongoDB,
    waitUntilSearchIndexIsListed,
    waitUntilSearchIsReady,
    type MongoDBIntegrationTestCase,
} from "../mongodbHelpers.js";
import { createMockElicitInput } from "../../../../utils/elicitationMocks.js";
import { Elicitation } from "../../../../../src/elicitation.js";

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
    beforeEach(async () => {
        await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        moviesCollection = mongoClient.db("mflix").collection("movies");
        await moviesCollection.insertMany([
            {
                name: "Movie1",
                plot: "This is a horrible movie about a database called BongoDB and how it tried to copy the OG MangoDB.",
            },
        ]);
        await waitUntilSearchIsReady(mongoClient);
        await moviesCollection.createSearchIndex({
            name: indexName,
            definition: { mappings: { dynamic: true } },
        });
        await waitUntilSearchIndexIsListed(moviesCollection, indexName);
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

describe("drop-index tool with classic indexes", () => {
    describeWithMongoDB("tool metadata and parameters", (integration) => {
        const invalidArgsTestCases = [
            ...databaseCollectionInvalidArgs,
            { database: "test", collection: "testColl", indexName: null },
            { database: "test", collection: "testColl", indexName: undefined },
            { database: "test", collection: "testColl", indexName: [] },
            { database: "test", collection: "testColl", indexName: true },
            { database: "test", collection: "testColl", indexName: false },
            { database: "test", collection: "testColl", indexName: 0 },
            { database: "test", collection: "testColl", indexName: 12 },
            { database: "test", collection: "testColl", indexName: "" },
        ];

        validateThrowsForInvalidArguments(integration, "drop-index", invalidArgsTestCases);
    });

    describeWithMongoDB("dropping classic indexes", (integration) => {
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
                        arguments: { database, collection, indexName: "non-existent" },
                    });
                    expect(response.isError).toBe(true);
                    const content = getResponseContent(response.content);
                    expect(content).toEqual(`Error running drop-index: ns does not exist: ${database}.${collection}`);
                });
            }
        );

        describe("when attempting to delete an index that does not exist", () => {
            it("should fail with error", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "drop-index",
                    arguments: {
                        database: "mflix",
                        collection: "movies",
                        indexName: "non-existent",
                    },
                });
                expect(response.isError).toBe(true);
                const content = getResponseContent(response.content);
                expect(content).toContain("Index does not exist in the provided namespace");
                expect(content).toContain("non-existent");
                expect(content).toContain("mflix.movies");
            });
        });

        describe("when attempting to delete an index that exists", () => {
            it("should succeed", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "drop-index",
                    // The index is created in beforeEach
                    arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
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
    });

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
                    arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
                });
                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining(
                        "You are about to drop the index named `year_1` from the `mflix.movies` namespace"
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
                    arguments: { database: "mflix", collection: "movies", indexName: getIndexName() },
                });
                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining(
                        "You are about to drop the index named `year_1` from the `mflix.movies` namespace"
                    ),
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                });
                expect(await getMoviesCollection().listIndexes().toArray()).toHaveLength(2);
            });
        },
        {
            getMockElicitationInput: () => mockElicitInput,
        }
    );
});

describe("drop-index tool with search indexes", () => {
    describeWithMongoDB(
        "dropping search indexes",
        (integration) => {
            const { getIndexName } = setupForVectorSearchIndexes(integration);

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
            ])(
                "when attempting to delete an index from non-existent namespace - $database $collection",
                ({ database, collection, indexName }) => {
                    it("should fail with error", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "drop-index",
                            arguments: { database, collection, indexName },
                        });
                        expect(response.isError).toBe(true);
                        const content = getResponseContent(response.content);
                        expect(content).toEqual(
                            `Error running drop-index: ns does not exist: ${database}.${collection}`
                        );
                    });
                }
            );
            describe("when attempting to delete an index that does not exist", () => {
                it("should fail with error", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "drop-index",
                        arguments: {
                            database: "mflix",
                            collection: "movies",
                            indexName: "non-existent",
                        },
                    });
                    expect(response.isError).toBe(true);
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Index does not exist in the provided namespace");
                    expect(content).toContain("non-existent");
                    expect(content).toContain("mflix.movies");
                });
            });

            describe("when attempting to delete an index that exists", () => {
                it("should succeed", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "drop-index",
                        arguments: {
                            database: "mflix",
                            collection: "movies",
                            indexName: getIndexName(),
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Successfully dropped the index from the provided namespace.");

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
        "dropping search indexes through an elicitation enabled client",
        (integration) => {
            const { getIndexName } = setupForVectorSearchIndexes(integration);
            let dropSearchIndexSpy: MockInstance;

            beforeEach(() => {
                // Note: Unlike drop-index tool test, we don't test the final state of
                // indexes because of possible longer wait periods for changes to
                // reflect, at-times taking >30 seconds.
                dropSearchIndexSpy = vi.spyOn(integration.mcpServer().session.serviceProvider, "dropSearchIndex");
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
                    },
                });
                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining(
                        `You are about to drop the index named \`${getIndexName()}\` from the \`mflix.movies\` namespace`
                    ),
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                });

                expect(dropSearchIndexSpy).toHaveBeenCalledExactlyOnceWith("mflix", "movies", getIndexName());
            });

            it("should not drop the index if the confirmation was not provided", async () => {
                mockElicitInput.confirmNo();
                await integration.mcpClient().callTool({
                    name: "drop-index",
                    arguments: {
                        database: "mflix",
                        collection: "movies",
                        indexName: getIndexName(),
                    },
                });
                expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
                expect(mockElicitInput.mock).toHaveBeenCalledWith({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining(
                        `You are about to drop the index named \`${getIndexName()}\` from the \`mflix.movies\` namespace`
                    ),
                    requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
                });
                expect(dropSearchIndexSpy).not.toHaveBeenCalled();
            });
        },
        {
            getUserConfig: () => ({ ...defaultTestConfig, voyageApiKey: "test-api-key" }),
            downloadOptions: { search: true },
            getMockElicitationInput: () => mockElicitInput,
        }
    );
});
