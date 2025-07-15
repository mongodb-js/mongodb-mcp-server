import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
} from "../../../helpers.js";
import { describe, expect, it } from "vitest";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("renameCollection tool", (integration) => {
    validateToolMetadata(integration, "rename-collection", "Renames a collection in a MongoDB database", [
        ...databaseCollectionParameters,

        {
            name: "newName",
            description: "The new name for the collection",
            type: "string",
            required: true,
        },
        {
            name: "dropTarget",
            description: "If true, drops the target collection if it exists",
            type: "boolean",
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "rename-collection", [
        {},
        { database: 123, collection: "bar" },
        { database: "test", collection: [], newName: "foo" },
        { database: "test", collection: "bar", newName: 10 },
        { database: "test", collection: "bar", newName: "foo", dropTarget: "true" },
        { database: "test", collection: "bar", newName: "foo", dropTarget: 1 },
    ]);

    describe("with non-existing database", () => {
        it("returns an error", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "rename-collection",
                arguments: { database: "non-existent", collection: "foos", newName: "bar" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(`Cannot rename "non-existent.foos" because it doesn't exist.`);
        });
    });

    describe("with non-existing collection", () => {
        it("returns an error", async () => {
            await integration.mongoClient().db(integration.randomDbName()).collection("bar").insertOne({});

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "rename-collection",
                arguments: { database: integration.randomDbName(), collection: "non-existent", newName: "foo" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Cannot rename "${integration.randomDbName()}.non-existent" because it doesn't exist.`
            );
        });
    });

    describe("with existing collection", () => {
        it("renames to non-existing collection", async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .insertOne({ value: 42 });

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "rename-collection",
                arguments: { database: integration.randomDbName(), collection: "before", newName: "after" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Collection "before" renamed to "after" in database "${integration.randomDbName()}".`
            );

            const docsInBefore = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .find({})
                .toArray();
            expect(docsInBefore).toHaveLength(0);

            const docsInAfter = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("after")
                .find({})
                .toArray();
            expect(docsInAfter).toHaveLength(1);
            expect(docsInAfter[0]?.value).toEqual(42);
        });

        it("returns an error when renaming to an existing collection", async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .insertOne({ value: 42 });
            await integration.mongoClient().db(integration.randomDbName()).collection("after").insertOne({ value: 84 });

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "rename-collection",
                arguments: { database: integration.randomDbName(), collection: "before", newName: "after" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Cannot rename "${integration.randomDbName()}.before" to "after" because the target collection already exists. If you want to overwrite it, set the "dropTarget" argument to true.`
            );

            // Ensure no data was lost
            const docsInBefore = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .find({})
                .toArray();
            expect(docsInBefore).toHaveLength(1);
            expect(docsInBefore[0]?.value).toEqual(42);

            const docsInAfter = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("after")
                .find({})
                .toArray();
            expect(docsInAfter).toHaveLength(1);
            expect(docsInAfter[0]?.value).toEqual(84);
        });

        it("renames to existing collection with dropTarget", async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .insertOne({ value: 42 });
            await integration.mongoClient().db(integration.randomDbName()).collection("after").insertOne({ value: 84 });

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "rename-collection",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "before",
                    newName: "after",
                    dropTarget: true,
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Collection "before" renamed to "after" in database "${integration.randomDbName()}".`
            );

            // Ensure the data was moved
            const docsInBefore = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("before")
                .find({})
                .toArray();
            expect(docsInBefore).toHaveLength(0);

            const docsInAfter = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("after")
                .find({})
                .toArray();
            expect(docsInAfter).toHaveLength(1);
            expect(docsInAfter[0]?.value).toEqual(42);
        });
    });

    validateAutoConnectBehavior(
        integration,
        "rename-collection",
        () => {
            return {
                args: { database: integration.randomDbName(), collection: "coll1", newName: "coll2" },
                expectedResponse: `Collection "coll1" renamed to "coll2" in database "${integration.randomDbName()}".`,
            };
        },
        async () => {
            await integration.mongoClient().db(integration.randomDbName()).createCollection("coll1");
        }
    );
});
