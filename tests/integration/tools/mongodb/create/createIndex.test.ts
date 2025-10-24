import { describeWithMongoDB, validateAutoConnectBehavior, waitUntilSearchIsReady } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
    defaultTestConfig,
    getResponseElements,
} from "../../../helpers.js";
import { ObjectId, type Collection, type Document, type IndexDirection } from "mongodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describeWithMongoDB("createIndex tool when search is not enabled", (integration) => {
    it("doesn't allow creating vector search indexes", async () => {
        expect(integration.mcpServer().userConfig.previewFeatures).to.not.include("vectorSearch");

        const { tools } = await integration.mcpClient().listTools();
        const createIndexTool = tools.find((tool) => tool.name === "create-index");
        const definitionProperty = createIndexTool?.inputSchema.properties?.definition as {
            type: string;
            items: { anyOf: Array<{ properties: Record<string, Record<string, unknown>> }> };
        };
        expectDefined(definitionProperty);

        expect(definitionProperty.type).toEqual("array");

        // Because search is not enabled, the only available index definition is 'classic'
        // We expect 1 option in the anyOf array where type is "classic"
        expect(definitionProperty.items.anyOf).toHaveLength(1);
        expect(definitionProperty.items.anyOf?.[0]?.properties?.type).toEqual({ type: "string", const: "classic" });
        expect(definitionProperty.items.anyOf?.[0]?.properties?.keys).toBeDefined();
    });
});

describeWithMongoDB(
    "createIndex tool when search is enabled",
    (integration) => {
        it("allows creating vector search indexes", async () => {
            expect(integration.mcpServer().userConfig.previewFeatures).includes("vectorSearch");

            const { tools } = await integration.mcpClient().listTools();
            const createIndexTool = tools.find((tool) => tool.name === "create-index");
            const definitionProperty = createIndexTool?.inputSchema.properties?.definition as {
                type: string;
                items: { anyOf: Array<{ properties: Record<string, Record<string, unknown>> }> };
            };
            expectDefined(definitionProperty);

            expect(definitionProperty.type).toEqual("array");

            // Because search is now enabled, we should see both "classic" and "vectorSearch" options in
            // the anyOf array.
            expect(definitionProperty.items.anyOf).toHaveLength(2);
            expect(definitionProperty.items.anyOf?.[0]?.properties?.type).toEqual({ type: "string", const: "classic" });
            expect(definitionProperty.items.anyOf?.[0]?.properties?.keys).toBeDefined();
            expect(definitionProperty.items.anyOf?.[1]?.properties?.type).toEqual({
                type: "string",
                const: "vectorSearch",
            });
            expect(definitionProperty.items.anyOf?.[1]?.properties?.fields).toBeDefined();

            const fields = definitionProperty.items.anyOf?.[1]?.properties?.fields as {
                type: string;
                items: { anyOf: Array<{ type: string; properties: Record<string, Record<string, unknown>> }> };
            };

            expect(fields.type).toEqual("array");
            expect(fields.items.anyOf).toHaveLength(2);
            expect(fields.items.anyOf?.[0]?.type).toEqual("object");
            expect(fields.items.anyOf?.[0]?.properties?.type).toEqual({ type: "string", const: "filter" });
            expectDefined(fields.items.anyOf?.[0]?.properties?.path);

            expect(fields.items.anyOf?.[1]?.type).toEqual("object");
            expect(fields.items.anyOf?.[1]?.properties?.type).toEqual({ type: "string", const: "vector" });
            expectDefined(fields.items.anyOf?.[1]?.properties?.path);
            expectDefined(fields.items.anyOf?.[1]?.properties?.quantization);
            expectDefined(fields.items.anyOf?.[1]?.properties?.numDimensions);
            expectDefined(fields.items.anyOf?.[1]?.properties?.similarity);
        });
    },
    {
        getUserConfig: () => {
            return {
                ...defaultTestConfig,
                previewFeatures: ["vectorSearch"],
            };
        },
    }
);

describeWithMongoDB(
    "createIndex tool with classic indexes",
    (integration) => {
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
            {
                collection: "bar",
                database: "test",
                definition: [{ type: "unknown", keys: { foo: 1 } }],
                name: "my-index",
            },
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
                definition: [{ type: "vectorSearch", fields: [{ type: "vector", path: true }] }],
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
                `Created the index "my-index" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop2_-1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_-1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`
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
                `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`
            );

            await validateIndex("coll1", [{ name: "prop1_1", key: { prop1: 1 } }]);
        });

        it("fails to create a vector search index", async () => {
            await integration.connectMcpClient();
            const collection = new ObjectId().toString();
            await integration.mongoClient().db(integration.randomDbName()).createCollection(collection);

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
            expect(content).toContain("The connected MongoDB deployment does not support vector search indexes.");
            expect(response.isError).toBe(true);
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
                    `Created the index "prop1_${direction}" on collection "coll1" in database "${integration.randomDbName()}".`
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
                expectedResponse: `Created the index "prop1_1" on collection "coll1" in database "${integration.randomDbName()}".`,
            };
        });
    },
    {
        getUserConfig: () => {
            return {
                ...defaultTestConfig,
                previewFeatures: ["vectorSearch"],
            };
        },
    }
);

describeWithMongoDB(
    "createIndex tool with vector search indexes",
    (integration) => {
        beforeEach(async () => {
            await integration.connectMcpClient();
            await waitUntilSearchIsReady(integration.mongoClient());
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
            let collectionName: string;
            let collection: Collection;
            beforeEach(async () => {
                collectionName = new ObjectId().toString();
                collection = await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .createCollection(collectionName);
            });

            afterEach(async () => {
                await collection.drop();
            });

            it("creates the index", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
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
                    `Created the index "vector_1_vector" on collection "${collectionName}" in database "${integration.randomDbName()}". Since this is a vector search index, it may take a while for the index to build. Use the \`list-indexes\` tool to check the index status.`
                );

                const indexes = (await collection.listSearchIndexes().toArray()) as unknown as Document[];
                expect(indexes).toHaveLength(1);
                expect(indexes[0]?.name).toEqual("vector_1_vector");
                expect(indexes[0]?.type).toEqual("vectorSearch");
                expect(indexes[0]?.status).toEqual("PENDING");
                expect(indexes[0]?.queryable).toEqual(false);
                expect(indexes[0]?.latestDefinition).toEqual({
                    fields: [
                        { type: "vector", path: "vector_1", numDimensions: 4, similarity: "euclidean" },
                        { type: "filter", path: "category" },
                    ],
                });
            });

            it("doesn't duplicate indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
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
                    `Created the index "vector_1_vector" on collection "${collectionName}" in database "${integration.randomDbName()}". Since this is a vector search index, it may take a while for the index to build. Use the \`list-indexes\` tool to check the index status.`
                );

                // Try to create another vector search index with the same name
                const duplicateVectorResponse = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
                        name: "vector_1_vector",
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [{ type: "vector", path: "vector_1", numDimensions: 4 }],
                            },
                        ],
                    },
                });

                const duplicateVectorContent = getResponseContent(duplicateVectorResponse.content);
                expect(duplicateVectorResponse.isError).toBe(true);
                expect(duplicateVectorContent).toEqual(
                    "Error running create-index: Index vector_1_vector already exists with a different definition. Drop it first if needed."
                );
            });

            it("can create classic and vector search indexes with the same name", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
                        name: "my-super-index",
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
                    `Created the index "my-super-index" on collection "${collectionName}" in database "${integration.randomDbName()}". Since this is a vector search index, it may take a while for the index to build. Use the \`list-indexes\` tool to check the index status.`
                );

                const classicResponse = await integration.mcpClient().callTool({
                    name: "create-index",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
                        name: "my-super-index",
                        definition: [{ type: "classic", keys: { field1: 1 } }],
                    },
                });

                // Create a classic index with the same name
                const classicContent = getResponseContent(classicResponse.content);
                expect(classicContent).toEqual(
                    `Created the index "my-super-index" on collection "${collectionName}" in database "${integration.randomDbName()}".`
                );

                const listIndexesResponse = await integration.mcpClient().callTool({
                    name: "collection-indexes",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: collectionName,
                    },
                });

                const listIndexesElements = getResponseElements(listIndexesResponse.content);
                expect(listIndexesElements).toHaveLength(4); // 2 elements for classic indexes, 2 for vector search indexes

                // Expect to find my-super-index in the classic definitions
                expect(listIndexesElements[1]?.text).toContain('"name":"my-super-index"');

                // Expect to find my-super-index in the vector search definitions
                expect(listIndexesElements[3]?.text).toContain('"name":"my-super-index"');
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["vectorSearch"],
        }),
        downloadOptions: {
            search: true,
        },
    }
);
