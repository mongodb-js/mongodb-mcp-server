import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
} from "../../../helpers.js";
import { describe, expect, it } from "vitest";

describeWithMongoDB("deleteMany tool", (integration) => {
    validateToolMetadata(
        integration,
        "delete-many",
        "Removes all documents that match the filter from a MongoDB collection",
        [
            ...databaseCollectionParameters,
            {
                name: "filter",
                type: "object",
                description:
                    "The query filter, specifying the deletion criteria. Matches the syntax of the filter argument of db.collection.deleteMany()",
                required: false,
            },
        ]
    );

    describe("with invalid arguments", () => {
        validateThrowsForInvalidArguments(integration, "delete-many", [
            {},
            { collection: "bar", database: 123, filter: {} },
            { collection: [], database: "test", filter: {} },
            { collection: "bar", database: "test", filter: "my-document" },
            { collection: "bar", database: "test", filter: [{ name: "Peter" }] },
        ]);
    });

    it("doesn't create the collection if it doesn't exist", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "delete-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                filter: {},
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain('Deleted `0` document(s) from collection "coll1"');

        const collections = await integration.mongoClient().db(integration.randomDbName()).listCollections().toArray();
        expect(collections).toHaveLength(0);
    });

    const insertDocuments = async (): Promise<void> => {
        await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection("coll1")
            .insertMany([
                { age: 10, name: "Peter" },
                { age: 20, name: "John" },
                { age: 30, name: "Mary" },
                { age: 40, name: "Lucy" },
            ]);
    };

    const validateDocuments = async (expected: object[]): Promise<void> => {
        const documents = await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection("coll1")
            .find()
            .toArray();

        expect(documents).toHaveLength(expected.length);
        for (const expectedDocument of expected) {
            expect(documents).toContainEqual(expect.objectContaining(expectedDocument));
        }
    };

    it("deletes documents matching the filter", async () => {
        await insertDocuments();

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "delete-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                filter: { age: { $gt: 20 } },
            },
        });
        const content = getResponseContent(response.content);
        expect(content).toContain('Deleted `2` document(s) from collection "coll1"');

        await validateDocuments([
            { age: 10, name: "Peter" },
            { age: 20, name: "John" },
        ]);
    });

    it("when filter doesn't match, deletes nothing", async () => {
        await insertDocuments();
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "delete-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                filter: { age: { $gt: 100 } },
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain('Deleted `0` document(s) from collection "coll1"');

        await validateDocuments([
            { age: 10, name: "Peter" },
            { age: 20, name: "John" },
            { age: 30, name: "Mary" },
            { age: 40, name: "Lucy" },
        ]);
    });

    it("with empty filter, deletes all documents", async () => {
        await insertDocuments();
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "delete-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                filter: {},
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain('Deleted `4` document(s) from collection "coll1"');

        await validateDocuments([]);
    });

    validateAutoConnectBehavior(integration, "delete-many", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                filter: {},
            },
            expectedResponse: 'Deleted `0` document(s) from collection "coll1"',
        };
    });
});
