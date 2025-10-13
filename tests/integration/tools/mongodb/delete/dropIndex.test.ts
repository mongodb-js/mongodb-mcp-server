import { describe, beforeEach, it, afterEach, expect } from "vitest";
import type { Collection } from "mongodb";
import {
    databaseCollectionInvalidArgs,
    databaseCollectionParameters,
    defaultDriverOptions,
    defaultTestConfig,
    getResponseContent,
    setupIntegrationTest,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../../helpers.js";
import { describeWithMongoDB } from "../mongodbHelpers.js";
import { createMockElicitInput } from "../../../../utils/elicitationMocks.js";
import { Elicitation } from "../../../../../src/elicitation.js";

describeWithMongoDB("drop-index tool", (integration) => {
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
        try {
            await moviesCollection.dropIndex(indexName);
        } catch (error) {
            if (error instanceof Error && !error.message.includes("index not found with name")) {
                throw error;
            }
        }
        await moviesCollection.drop();
    });

    validateToolMetadata(integration, "drop-index", "Drop an index for the provided database and collection.", [
        ...databaseCollectionParameters,
        {
            name: "indexName",
            type: "string",
            description: "The name of the index to be dropped.",
            required: true,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "drop-index", [
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
                expect(content).toEqual(`Error running drop-index: ns not found ${database}.${collection}`);
            });
        }
    );

    describe("when attempting to delete an index that does not exist", () => {
        it("should fail with error", async () => {
            const response = await integration.mcpClient().callTool({
                name: "drop-index",
                arguments: { database: "mflix", collection: "movies", indexName: "non-existent" },
            });
            expect(response.isError).toBe(true);
            const content = getResponseContent(response.content);
            expect(content).toEqual(`Error running drop-index: index not found with name [non-existent]`);
        });
    });

    describe("when attempting to delete an index that exists", () => {
        it("should succeed", async () => {
            const response = await integration.mcpClient().callTool({
                name: "drop-index",
                // The index is created in beforeEach
                arguments: { database: "mflix", collection: "movies", indexName: indexName },
            });
            expect(response.isError).toBe(undefined);
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Successfully dropped the index with name "${indexName}" from the provided namespace "mflix.movies".`
            );
        });
    });
});

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
            name: "drop-index",
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
