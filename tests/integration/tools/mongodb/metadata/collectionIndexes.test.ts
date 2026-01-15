import type { Collection, IndexDirection } from "mongodb";
import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
    databaseCollectionInvalidArgs,
    getDataFromUntrustedContent,
    getResponseContent,
    defaultTestConfig,
    expectDefined,
} from "../../../helpers.js";
import {
    describeWithMongoDB,
    validateAutoConnectBehavior,
    waitUntilSearchIndexIsQueryable,
    waitUntilSearchIsReady,
} from "../mongodbHelpers.js";
import { beforeEach, describe, expect, it } from "vitest";

const getIndexesFromContent = (content?: string): Array<unknown> => {
    const data = getDataFromUntrustedContent(content || "");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return data.split("\n").map((line) => JSON.parse(line));
};

describeWithMongoDB("collectionIndexes tool", (integration) => {
    validateToolMetadata(
        integration,
        "collection-indexes",
        "Describe the indexes for a collection",
        "metadata",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "collection-indexes", databaseCollectionInvalidArgs);

    it("can inspect indexes on non-existent database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: { database: "non-existent", collection: "people" },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(1);
        expect(elements[0]?.text).toEqual(
            'The indexes for "non-existent.people" cannot be determined because the collection does not exist.'
        );
    });

    it("returns the _id index for a new collection", async () => {
        await integration.mongoClient().db(integration.randomDbName()).createCollection("people");

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
            },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(2);
        expect(elements[0]?.text).toEqual('Found 1 classic indexes in the collection "people":');
        const indexDefinitions = getIndexesFromContent(elements[1]?.text);
        expect(indexDefinitions).toEqual([{ name: "_id_", key: { _id: 1 } }]);
    });

    it("returns all indexes for a collection", async () => {
        await integration.mongoClient().db(integration.randomDbName()).createCollection("people");

        const indexTypes: IndexDirection[] = [-1, 1, "2d", "2dsphere", "text", "hashed"];
        const indexNames: Map<IndexDirection, string> = new Map();
        for (const indexType of indexTypes) {
            const indexName = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("people")
                .createIndex({ [`prop_${indexType}`]: indexType });

            indexNames.set(indexType, indexName);
        }

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
            },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(2);

        expect(elements[0]?.text).toEqual(`Found ${indexTypes.length + 1} classic indexes in the collection "people":`);
        const indexDefinitions = getIndexesFromContent(elements[1]?.text);
        expect(indexDefinitions).toContainEqual({ name: "_id_", key: { _id: 1 } });

        for (const indexType of indexTypes) {
            let expectedDefinition = { [`prop_${indexType}`]: indexType };
            if (indexType === "text") {
                expectedDefinition = { _fts: "text", _ftsx: 1 };
            }

            expect(indexDefinitions).toContainEqual({
                name: indexNames.get(indexType),
                key: expectedDefinition,
            });
        }
    });

    validateAutoConnectBehavior(integration, "collection-indexes", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: `The indexes for "${integration.randomDbName()}.coll1" cannot be determined because the collection does not exist.`,
        };
    });
});
const SEARCH_TIMEOUT = 20_000;

describeWithMongoDB(
    "collection-indexes tool with Search",
    (integration) => {
        let collection: Collection;

        beforeEach(async () => {
            await integration.connectMcpClient();
            collection = integration.mongoClient().db(integration.randomDbName()).collection("foo");
            await waitUntilSearchIsReady(integration.mongoClient());
        });

        describe("when the collection does not exist", () => {
            it("returns an empty list of indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "collection-indexes",
                    arguments: { database: "any", collection: "foo" },
                });
                const responseContent = getResponseContent(response.content);
                expect(responseContent).toContain(
                    'The indexes for "any.foo" cannot be determined because the collection does not exist.'
                );
            });
        });

        describe("when there are no search indexes", () => {
            beforeEach(async () => {
                await collection.createIndexes([{ key: { foo: 1 } }]);
            });

            it("returns just the regular indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "collection-indexes",
                    arguments: { database: integration.randomDbName(), collection: "foo" },
                });

                const responseElements = getResponseElements(response.content);
                expect(responseElements).toHaveLength(2);
                // Expect 2 indexes - _id_ and foo_1
                expect(responseElements[0]?.text).toContain('Found 2 classic indexes in the collection "foo"');

                const responseContent = getResponseContent(response.content);
                expect(responseContent).not.toContain("search and vector search indexes");
            });
        });

        describe("when there are vector search indexes", () => {
            beforeEach(async () => {
                await collection.insertOne({
                    field1: "yay",
                    age: 1,
                    field1_embeddings: [1, 2, 3, 4],
                });
                await collection.createSearchIndexes([
                    {
                        name: "my-vector-index",
                        definition: {
                            fields: [
                                { type: "vector", path: "field1_embeddings", numDimensions: 4, similarity: "cosine" },
                            ],
                        },
                        type: "vectorSearch",
                    },
                    {
                        name: "my-mixed-index",
                        definition: {
                            fields: [
                                {
                                    type: "vector",
                                    path: "field1_embeddings",
                                    numDimensions: 4,
                                    similarity: "euclidean",
                                },
                                { type: "filter", path: "age" },
                            ],
                        },
                        type: "vectorSearch",
                    },
                ]);
            });

            it("returns the list of existing indexes", { timeout: SEARCH_TIMEOUT }, async () => {
                const response = await integration.mcpClient().callTool({
                    name: "collection-indexes",
                    arguments: { database: integration.randomDbName(), collection: "foo" },
                });

                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(4);

                // Expect 1 regular index - _id_
                expect(elements[0]?.text).toContain(`Found 1 classic indexes in the collection "foo":`);
                expect(elements[2]?.text).toContain(
                    `Found 2 search and vector search indexes in the collection "foo":`
                );

                const indexDefinitions = getIndexesFromContent(elements[3]?.text) as {
                    name: string;
                    type: string;
                    latestDefinition: { fields: unknown[] };
                }[];

                expect(indexDefinitions).toHaveLength(2);

                const vectorIndexDefinition = indexDefinitions.find((def) => def.name === "my-vector-index");
                expectDefined(vectorIndexDefinition);
                expect(vectorIndexDefinition).toHaveProperty("name", "my-vector-index");
                expect(vectorIndexDefinition).toHaveProperty("type", "vectorSearch");

                const fields0 = vectorIndexDefinition.latestDefinition.fields;
                expect(fields0).toHaveLength(1);
                expect(fields0[0]).toHaveProperty("type", "vector");
                expect(fields0[0]).toHaveProperty("path", "field1_embeddings");

                const mixedIndexDefinition = indexDefinitions.find((def) => def.name === "my-mixed-index");
                expectDefined(mixedIndexDefinition);
                expect(mixedIndexDefinition).toHaveProperty("name", "my-mixed-index");
                expect(mixedIndexDefinition).toHaveProperty("type", "vectorSearch");
                const fields1 = mixedIndexDefinition.latestDefinition.fields;
                expectDefined(fields1);
                expect(fields1).toHaveLength(2);
                expect(fields1[0]).toHaveProperty("type", "vector");
                expect(fields1[0]).toHaveProperty("path", "field1_embeddings");
                expect(fields1[1]).toHaveProperty("type", "filter");
                expect(fields1[1]).toHaveProperty("path", "age");
            });

            it(
                "returns the list of existing indexes and detects if they are queryable",
                { timeout: SEARCH_TIMEOUT },
                async () => {
                    await waitUntilSearchIndexIsQueryable(collection, "my-vector-index");
                    await waitUntilSearchIndexIsQueryable(collection, "my-mixed-index");

                    const response = await integration.mcpClient().callTool({
                        name: "collection-indexes",
                        arguments: { database: integration.randomDbName(), collection: "foo" },
                    });

                    const elements = getResponseElements(response.content);
                    const indexDefinitions = getIndexesFromContent(elements[3]?.text) as {
                        name: string;
                    }[];

                    const vectorIndexDefinition = indexDefinitions.find((def) => def.name === "my-vector-index");

                    expect(vectorIndexDefinition).toHaveProperty("queryable", true);
                    expect(vectorIndexDefinition).toHaveProperty("status", "READY");

                    const mixedIndexDefinition = indexDefinitions.find((def) => def.name === "my-mixed-index");
                    expect(mixedIndexDefinition).toHaveProperty("queryable", true);
                    expect(mixedIndexDefinition).toHaveProperty("status", "READY");
                }
            );
        });

        describe("when there are Atlas search indexes", () => {
            beforeEach(async () => {
                await collection.insertOne({ field1: "yay", age: 1 });
                await collection.createSearchIndexes([
                    { name: "my-search-index", definition: { mappings: { dynamic: true } }, type: "search" },
                ]);
            });

            it("returns them alongside the regular indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "collection-indexes",
                    arguments: { database: integration.randomDbName(), collection: "foo" },
                });

                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(4);
                // Expect 1 regular index - _id_
                expect(elements[0]?.text).toContain(`Found 1 classic indexes in the collection "foo":`);
                expect(elements[2]?.text).toContain(
                    `Found 1 search and vector search indexes in the collection "foo":`
                );

                const indexDefinitions = getIndexesFromContent(elements[3]?.text) as {
                    name: string;
                    type: string;
                    latestDefinition: unknown;
                }[];

                expect(indexDefinitions).toHaveLength(1);
                expect(indexDefinitions[0]).toHaveProperty("name", "my-search-index");
                expect(indexDefinitions[0]).toHaveProperty("type", "search");
                expect(indexDefinitions[0]).toHaveProperty("latestDefinition", {
                    mappings: { dynamic: true, fields: {} },
                });
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["search"],
        }),
        downloadOptions: { search: true },
    }
);

describeWithMongoDB(
    "collection-indexes tool with support for auto-embed indexes",
    (integration) => {
        let collection: Collection;

        beforeEach(async () => {
            await integration.connectMcpClient();
            collection = integration.mongoClient().db(integration.randomDbName()).collection("foo");
            await waitUntilSearchIsReady(integration.mongoClient());

            await collection.insertMany([
                {
                    plot: "A really bad alien movie.",
                },
                {
                    plot: "A movie about delicious pizza.",
                },
            ]);
            await collection.createSearchIndexes([
                {
                    type: "vectorSearch",
                    name: "my-auto-embed-index",
                    definition: {
                        fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
                    },
                },
                {
                    name: "my-mixed-index",
                    definition: {
                        fields: [
                            {
                                type: "vector",
                                path: "field1_embeddings",
                                numDimensions: 4,
                                similarity: "euclidean",
                            },
                            { type: "filter", path: "age" },
                        ],
                    },
                    type: "vectorSearch",
                },
            ]);
        });

        it("returns the list of indexes including auto-embed indexes", { timeout: SEARCH_TIMEOUT }, async () => {
            const response = await integration.mcpClient().callTool({
                name: "collection-indexes",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });

            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(4);

            // Expect 1 regular index - _id_
            expect(elements[0]?.text).toContain(`Found 1 classic indexes in the collection "foo":`);
            expect(elements[2]?.text).toContain(`Found 2 search and vector search indexes in the collection "foo":`);

            const indexDefinitions = getIndexesFromContent(elements[3]?.text) as {
                name: string;
                type: string;
                latestDefinition: { fields: unknown[] };
            }[];

            expect(indexDefinitions).toHaveLength(2);

            const vectorIndexDefinition = indexDefinitions.find((def) => def.name === "my-auto-embed-index");
            expectDefined(vectorIndexDefinition);
            expect(vectorIndexDefinition).toHaveProperty("name", "my-auto-embed-index");
            expect(vectorIndexDefinition).toHaveProperty("type", "vectorSearch");

            const fields0 = vectorIndexDefinition.latestDefinition.fields;
            expect(fields0).toHaveLength(1);
            expect(fields0[0]).toHaveProperty("type", "autoEmbed");
            expect(fields0[0]).toHaveProperty("path", "plot");
            expect(fields0[0]).toHaveProperty("model", "voyage-4-large");
            expect(fields0[0]).toHaveProperty("modality", "text");

            const mixedIndexDefinition = indexDefinitions.find((def) => def.name === "my-mixed-index");
            expectDefined(mixedIndexDefinition);
            expect(mixedIndexDefinition).toHaveProperty("name", "my-mixed-index");
            expect(mixedIndexDefinition).toHaveProperty("type", "vectorSearch");
            const fields1 = mixedIndexDefinition.latestDefinition.fields;
            expectDefined(fields1);
            expect(fields1).toHaveLength(2);
            expect(fields1[0]).toHaveProperty("type", "vector");
            expect(fields1[0]).toHaveProperty("path", "field1_embeddings");
            expect(fields1[1]).toHaveProperty("type", "filter");
            expect(fields1[1]).toHaveProperty("path", "age");
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: ["search"],
        }),
        downloadOptions: {
            autoEmbed: true,
            mongotPassword: process.env.MDB_MONGOT_PASSWORD as string,
            voyageIndexingKey: process.env.MDB_VOYAGE_API_KEY as string,
            voyageQueryKey: process.env.MDB_VOYAGE_API_KEY as string,
        },
    }
);

describeWithMongoDB(
    "collectionIndexes tool without voyage API key",
    (integration) => {
        let collection: Collection;

        beforeEach(async () => {
            await integration.connectMcpClient();
            collection = integration.mongoClient().db(integration.randomDbName()).collection("foo");
            await waitUntilSearchIsReady(integration.mongoClient());

            await collection.insertOne({ field1: "yay", age: 1 });
            await collection.createSearchIndexes([
                {
                    name: "my-vector-index",
                    definition: {
                        fields: [{ type: "vector", path: "field1_embeddings", numDimensions: 4, similarity: "cosine" }],
                    },
                    type: "vectorSearch",
                },
            ]);
        });
        it("does not return search indexes", async () => {
            const response = await integration.mcpClient().callTool({
                name: "collection-indexes",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });

            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(2);
            // Expect 1 regular index - _id_
            expect(elements[0]?.text).toContain(`Found 1 classic indexes in the collection "foo"`);

            const responseContent = getResponseContent(response.content);
            expect(responseContent).not.toContain("search and vector search indexes");

            // Ensure that we do have search indexes
            const searchIndexes = await collection.listSearchIndexes().toArray();
            expect(searchIndexes).toHaveLength(1);
            expect(searchIndexes[0]).toHaveProperty("name", "my-vector-index");
        });
    },
    {
        downloadOptions: { search: true },
    }
);
