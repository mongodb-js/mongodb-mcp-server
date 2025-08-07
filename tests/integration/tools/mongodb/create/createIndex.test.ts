import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import { IndexDirection } from "mongodb";
import { expect, it } from "vitest";

describeWithMongoDB("createIndex tool", (integration) => {
    validateToolMetadata(integration, "create-index", "Create an index for a collection", [
        ...databaseCollectionParameters,
        {
            name: "keys",
            type: "object",
            description: "The index definition",
            required: true,
        },
        {
            name: "name",
            type: "string",
            description: "The name of the index",
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "create-index", [
        {},
        { collection: "bar", database: 123, keys: { foo: 1 } },
        { collection: [], database: "test", keys: { foo: 1 } },
        { collection: "bar", database: "test", keys: { foo: 1 }, name: 123 },
        { collection: "bar", database: "test", keys: "foo", name: "my-index" },
    ]);

    const validateIndex = async (collection: string, expected: { name: string; key: object }[]): Promise<void> => {
        const mongoClient = integration.mongoClient();
        const collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
        expect(collections).toHaveLength(1);
        expect(collections[0]?.name).toEqual("coll1");
        const indexes = await mongoClient.db(integration.randomDbName()).collection(collection).indexes();
        expect(indexes).toHaveLength(expected.length + 1);
        expect(indexes[0]?.name).toEqual("_id_");
        for (const index of expected) {
            const foundIndex = indexes.find((i) => i.name === index.name);
            expectDefined(foundIndex);
            expect(foundIndex.key).toEqual(index.key);
        }
    };

    it("creates the namespace if necessary", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                keys: { prop1: 1 },
                name: "my-index",
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toEqual(
            `Created the index "my-index" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        await validateIndex("coll1", [{ name: "my-index", key: { prop1: 1 } }]);
    });

    it("generates a name if not provided", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: 1 } },
        });

        const content = getResponseContent(response.content);
        expect(content).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );
        await validateIndex("coll1", [{ name: "prop1_1", key: { prop1: 1 } }]);
    });

    it("can create multiple indexes in the same collection", async () => {
        await integration.connectMcpClient();
        let response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: 1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop2: -1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop2_-1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        await validateIndex("coll1", [
            { name: "prop1_1", key: { prop1: 1 } },
            { name: "prop2_-1", key: { prop2: -1 } },
        ]);
    });

    it("can create multiple indexes on the same property", async () => {
        await integration.connectMcpClient();
        let response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: 1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: -1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_-1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        await validateIndex("coll1", [
            { name: "prop1_1", key: { prop1: 1 } },
            { name: "prop1_-1", key: { prop1: -1 } },
        ]);
    });

    it("doesn't duplicate indexes", async () => {
        await integration.connectMcpClient();
        let response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: 1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: 1 } },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        await validateIndex("coll1", [{ name: "prop1_1", key: { prop1: 1 } }]);
    });

    const testCases: { name: string; direction: IndexDirection }[] = [
        { name: "descending", direction: -1 },
        { name: "ascending", direction: 1 },
        { name: "hashed", direction: "hashed" },
        { name: "text", direction: "text" },
        { name: "geoHaystack", direction: "2dsphere" },
        { name: "geo2d", direction: "2d" },
    ];

    for (const { name, direction } of testCases) {
        it(`creates ${name} index`, async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "create-index",
                arguments: { database: integration.randomDbName(), collection: "coll1", keys: { prop1: direction } },
            });

            expect(getResponseContent(response.content)).toEqual(
                `Created the index "prop1_${direction}" on collection "coll1" in database "${integration.randomDbName()}"`
            );

            let expectedKey: object = { prop1: direction };
            if (direction === "text") {
                expectedKey = {
                    _fts: "text",
                    _ftsx: 1,
                };
            }
            await validateIndex("coll1", [{ name: `prop1_${direction}`, key: expectedKey }]);
        });
    }

    validateAutoConnectBehavior(integration, "create-index", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                keys: { prop1: 1 },
            },
            expectedResponse: `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`,
        };
    });
});
