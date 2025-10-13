import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
    databaseCollectionInvalidArgs,
    databaseCollectionParameters,
    defaultDriverOptions,
    defaultTestConfig,
    getResponseContent,
    setupIntegrationTest,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
    waitUntilSearchManagementServiceIsReady,
    waitUntilSearchIndexIsListed,
} from "../../../helpers.js";
import { describeWithMongoDB } from "../mongodbHelpers.js";
import type { Collection } from "mongodb";
import { createMockElicitInput } from "../../../../utils/elicitationMocks.js";
import { Elicitation } from "../../../../../src/elicitation.js";

const SEARCH_TIMEOUT = 20_000;

describeWithMongoDB("drop-search-index tool - metadata and parameters", (integration) => {
    validateToolMetadata(
        integration,
        "drop-search-index",
        "Drop a search index or vector search index for the provided database and collection.",
        [
            ...databaseCollectionParameters,
            {
                name: "indexName",
                type: "string",
                description: "The name of the search or vector search index to be dropped.",
                required: true,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "drop-search-index", [
        ...databaseCollectionInvalidArgs,
        { database: "test", collection: "testColl", indexName: null },
        { database: "test", collection: "testColl", indexName: undefined },
        { database: "test", collection: "testColl", indexName: [] },
        { database: "test", collection: "testColl", indexName: true },
        { database: "test", collection: "testColl", indexName: false },
        { database: "test", collection: "testColl", indexName: 0 },
        { database: "test", collection: "testColl", indexName: 12 },
        { database: "test", collection: "testColl", indexName: "" },
    ]);
});

describeWithMongoDB("drop-search-index tool - when connected to MongoDB without search support", (integration) => {
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
});

describeWithMongoDB(
    "drop-search-index tool - when connected to MongoDB with search support",
    (integration) => {
        beforeEach(async () => {
            await integration.connectMcpClient();
        });

        describe("when attempting to delete a non-existent index", () => {
            it("should fail with appropriate error", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "drop-search-index",
                    arguments: { database: "any", collection: "foo", indexName: "non-existent" },
                });
                expect(response.isError).toBe(true);
                const content = getResponseContent(response.content);
                expect(content).toEqual(
                    'Index with name "non-existent" does not exist in the provided namespace "any.foo".'
                );
            });
        });

        describe("when attempting to delete an existing index", () => {
            let moviesCollection: Collection;
            beforeEach(async ({ signal }) => {
                const mongoClient = integration.mongoClient();
                moviesCollection = mongoClient.db("mflix").collection("movies");
                await moviesCollection.insertMany([
                    {
                        name: "Movie1",
                        plot: "This is a horrible movie about a database called BongoDB and how it tried to copy the original MangoDB.",
                    },
                ]);
                await waitUntilSearchManagementServiceIsReady(moviesCollection, signal);
                await moviesCollection.createSearchIndex({
                    name: "searchIdx",
                    definition: { mappings: { dynamic: true } },
                });
                await waitUntilSearchIndexIsListed(moviesCollection, "searchIdx", signal);
            });

            afterEach(async () => {
                try {
                    await moviesCollection.dropSearchIndex("searchIdx");
                } catch (error) {
                    if (error instanceof Error && !error.message.includes("not found in")) {
                        throw error;
                    }
                }
                await moviesCollection.drop();
            });

            it("should succeed in deleting the index", { timeout: SEARCH_TIMEOUT }, async () => {
                const response = await integration.mcpClient().callTool({
                    name: "drop-search-index",
                    arguments: { database: "mflix", collection: "movies", indexName: "searchIdx" },
                });
                const content = getResponseContent(response.content);
                expect(content).toEqual(
                    'Successfully dropped the index with name "searchIdx" from the provided namespace "mflix.movies".'
                );
            });
        });
    },
    undefined,
    undefined,
    { search: true }
);

describe("drop-search-index tool - when invoked via an elicitation enabled client", () => {
    const mockElicitInput = createMockElicitInput();
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions,
        { elicitInput: mockElicitInput }
    );

    it("should ask for confirmation before proceeding with tool call", async () => {
        mockElicitInput.confirmYes();
        await integration.mcpClient().callTool({
            name: "drop-search-index",
            arguments: { database: "any", collection: "foo", indexName: "default" },
        });
        expect(mockElicitInput.mock).toHaveBeenCalledTimes(1);
        expect(mockElicitInput.mock).toHaveBeenCalledWith({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            message: expect.stringContaining("You are about to drop the `default` index from the `any.foo` namespace"),
            requestedSchema: Elicitation.CONFIRMATION_SCHEMA,
        });
    });
});
