import { describeWithMongoDB, validateAutoConnectBehavior, waitUntilSearchIsReady } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import { ObjectId, type IndexDirection } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";

describeWithMongoDB("createIndex tool with classic indexes", (integration) => {
    validateToolMetadata(integration, "create-index", "Create an index for a collection", [
        ...databaseCollectionParameters,
        {
            name: "definition",
            type: "array",
            description:
                "The index definition. Use 'classic' for standard indexes and 'vectorSearch' for vector search indexes",
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
        { collection: "bar", database: 123, definition: [{ type: "classic", keys: { foo: 1 } }] },
        { collection: [], database: "test", definition: [{ type: "classic", keys: { foo: 1 } }] },
        { collection: "bar", database: "test", definition: [{ type: "classic", keys: { foo: 1 } }], name: 123 },
        { collection: "bar", database: "test", definition: [{ type: "unknown", keys: { foo: 1 } }], name: "my-index" },
        {
            collection: "bar",
            database: "test",
            definition: [{ type: "vectorSearch", fields: { foo: 1 } }],
        },
        {
            collection: "bar",
            database: "test",
            definition: [{ type: "vectorSearch", fields: [] }],
        },
        {
            collection: "bar",
            database: "test",
            definition: [{ type: "vectorSearch", fields: [{ type: "vector", path: "foo" }] }],
        },
        {
            collection: "bar",
            database: "test",
            definition: [{ type: "vectorSearch", fields: [{ type: "filter", path: "foo" }] }],
        },
        {
            collection: "bar",
            database: "test",
            definition: [
                {
                    type: "vectorSearch",
                    fields: [
                        { type: "vector", path: "foo", numDimensions: 128 },
                        { type: "filter", path: "bar", numDimensions: 128 },
                    ],
                },
            ],
        },
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
                definition: [
                    {
                        type: "classic",
                        keys: { prop1: 1 },
                    },
                ],
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
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
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
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop2: -1 } }],
            },
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
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: -1 } }],
            },
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
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
        });

        expect(getResponseContent(response.content)).toEqual(
            `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`
        );

        response = await integration.mcpClient().callTool({
            name: "create-index",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
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
                arguments: {
                    database: integration.randomDbName(),
                    collection: "coll1",
                    definition: [{ type: "classic", keys: { prop1: direction } }],
                },
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
                definition: [{ type: "classic", keys: { prop1: 1 } }],
            },
            expectedResponse: `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}"`,
        };
    });
});

describeWithMongoDB(
    "createIndex tool with vector search indexes",
    (integration) => {
        let provider: NodeDriverServiceProvider;

        beforeEach(async ({ signal }) => {
            await integration.connectMcpClient();
            provider = integration.mcpServer().session.serviceProvider;
            await waitUntilSearchIsReady(provider, signal);
        });

        describe("when the collection does not exist", () => {
            it("throws an error", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    { type: "vector", path: "vector_1", numDimensions: 4 },
                                    { type: "filter", path: "category" },
                                ],
                            },
                        ],
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain(`Collection '${integration.randomDbName()}.foo' does not exist`);
            });
        });

        describe("when the database does not exist", () => {
            it("throws an error", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: "nonexistent_db",
                        collection: "foo",
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [{ type: "vector", path: "vector_1", numDimensions: 4 }],
                            },
                        ],
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain(`Collection 'nonexistent_db.foo' does not exist`);
            });
        });

        describe("when the collection exists", () => {
            it("creates the index", async () => {
                const collection = new ObjectId().toString();
                await provider.createCollection(integration.randomDbName(), collection);
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection,
                        name: "vector_1_vector",
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    { type: "vector", path: "vector_1", numDimensions: 4 },
                                    { type: "filter", path: "category" },
                                ],
                            },
                        ],
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toEqual(
                    `Created the index "vector_1_vector" on collection "${collection}" in database "${integration.randomDbName()}"`
                );

                const indexes = await provider.getSearchIndexes(integration.randomDbName(), collection);
                expect(indexes).toHaveLength(1);
                expect(indexes[0]?.name).toEqual("vector_1_vector");
                expect(indexes[0]?.type).toEqual("vectorSearch");
                expect(indexes[0]?.status).toEqual("PENDING");
                expect(indexes[0]?.queryable).toEqual(false);
                expect(indexes[0]?.latestDefinition).toEqual({
                    fields: [
                        { type: "vector", path: "vector_1", numDimensions: 4, similarity: "cosine" },
                        { type: "filter", path: "category" },
                    ],
                });
            });
        });
    },
    undefined,
    undefined,
    {
        search: true,
    }
);
