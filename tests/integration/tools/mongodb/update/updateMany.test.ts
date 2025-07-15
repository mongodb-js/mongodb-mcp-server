import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseContent,
} from "../../../helpers.js";
import { beforeEach, describe, expect, it } from "vitest";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("updateMany tool", (integration) => {
    validateToolMetadata(
        integration,
        "update-many",
        "Updates all documents that match the specified filter for a collection",
        [
            ...databaseCollectionParameters,

            {
                name: "filter",
                description:
                    "The selection criteria for the update, matching the syntax of the filter argument of db.collection.updateOne()",
                type: "object",
                required: false,
            },
            {
                name: "update",
                description:
                    "An update document describing the modifications to apply using update operator expressions",
                type: "object",
                required: true,
            },
            {
                name: "upsert",
                description: "Controls whether to insert a new document if no documents match the filter",
                type: "boolean",
                required: false,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "update-many", [
        {},
        { database: 123, collection: "bar", update: {} },
        { database: [], collection: "bar", update: {} },
        { database: "test", collection: "bar", update: [] },
        { database: "test", collection: "bar", update: {}, filter: 123 },
        { database: "test", collection: "bar", update: {}, upsert: "true" },
        { database: "test", collection: "bar", update: {}, filter: {}, upsert: "true" },
        { database: "test", collection: "bar", update: {}, filter: "TRUEPREDICATE", upsert: false },
    ]);

    describe("with non-existent database", () => {
        it("doesn't update any documents", async () => {
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: "non-existent-db",
                    collection: "coll1",
                    update: { $set: { name: "new-name" } },
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toEqual("No documents matched the filter.");
        });
    });

    describe("with non-existent collection", () => {
        it("doesn't update any documents", async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .insertOne({ name: "old-name" });
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "non-existent",
                    update: { $set: { name: "new-name" } },
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toEqual("No documents matched the filter.");
        });
    });

    describe("with existing collection", () => {
        beforeEach(async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .insertMany([
                    { name: "old-name", value: 1 },
                    { name: "old-name", value: 2 },
                    { name: "old-name", value: 3 },
                ]);
        });
        it("updates all documents without filter", async () => {
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "coll1",
                    update: { $set: { name: "new-name" } },
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toEqual("Matched 3 document(s). Modified 3 document(s).");

            const docs = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .find({})
                .toArray();

            expect(docs).toHaveLength(3);
            for (const doc of docs) {
                expect(doc.name).toEqual("new-name");
            }
        });

        it("updates all documents that match the filter", async () => {
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "coll1",
                    update: { $set: { name: "new-name" } },
                    filter: { value: { $gt: 1 } },
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toEqual("Matched 2 document(s). Modified 2 document(s).");

            const docs = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .find({})
                .toArray();
            expect(docs).toHaveLength(3);
            for (const doc of docs) {
                if (doc.value > 1) {
                    expect(doc.name).toEqual("new-name");
                } else {
                    expect(doc.name).toEqual("old-name");
                }
            }
        });

        it("upserts a new document if no documents match the filter", async () => {
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "coll1",
                    update: { $set: { name: "new-name" } },
                    filter: { value: 4 },
                    upsert: true,
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toContain("Matched 0 document(s). Upserted 1 document with id:");

            const docs = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .find({})
                .toArray();

            expect(docs).toHaveLength(4);
            for (const doc of docs) {
                if (doc.value === 4) {
                    expect(doc.name).toEqual("new-name");
                } else {
                    expect(doc.name).toEqual("old-name");
                }
            }
        });

        it("doesn't upsert a new document if no documents match the filter and upsert is false", async () => {
            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({
                name: "update-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "coll1",
                    update: { $set: { name: "new-name" } },
                    filter: { value: 4 },
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toContain("No documents matched the filter.");

            const docs = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("coll1")
                .find({})
                .toArray();

            expect(docs).toHaveLength(3);
            for (const doc of docs) {
                expect(doc.name).toEqual("old-name");
            }
        });
    });

    validateAutoConnectBehavior(integration, "update-many", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                update: { $set: { name: "new-name" } },
            },
            expectedResponse: "No documents matched the filter.",
        };
    });
});
