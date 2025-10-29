import {
    describeWithMongoDB,
    validateAutoConnectBehavior,
    createVectorSearchIndexAndWait,
    waitUntilSearchIsReady,
} from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
    getDataFromUntrustedContent,
    defaultTestConfig,
} from "../../../helpers.js";
import { beforeEach, afterEach, expect, it, describe } from "vitest";
import { ObjectId } from "bson";
import type { Collection } from "mongodb";

describeWithMongoDB("insertMany tool when search is disabled", (integration) => {
    validateToolMetadata(integration, "insert-many", "Insert an array of documents into a MongoDB collection", [
        ...databaseCollectionParameters,
        {
            name: "documents",
            type: "array",
            description:
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany().",
            required: true,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "insert-many", [
        {},
        { collection: "bar", database: 123, documents: [] },
        { collection: [], database: "test", documents: [] },
        { collection: "bar", database: "test", documents: "my-document" },
        { collection: "bar", database: "test", documents: { name: "Peter" } },
    ]);

    const validateDocuments = async (collection: string, expectedDocuments: object[]): Promise<void> => {
        const collections = await integration.mongoClient().db(integration.randomDbName()).listCollections().toArray();
        expectDefined(collections.find((c) => c.name === collection));

        const docs = await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection(collection)
            .find()
            .toArray();

        expect(docs).toHaveLength(expectedDocuments.length);
        for (const expectedDocument of expectedDocuments) {
            expect(docs).toContainEqual(expect.objectContaining(expectedDocument));
        }
    };

    it("creates the namespace if necessary", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1" }],
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain(`Inserted \`1\` document(s) into ${integration.randomDbName()}.coll1.`);

        await validateDocuments("coll1", [{ prop1: "value1" }]);
    });

    it("returns an error when inserting duplicates", async () => {
        const { insertedIds } = await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection("coll1")
            .insertMany([{ prop1: "value1" }]);

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1", _id: { $oid: insertedIds[0] } }],
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain("Error running insert-many");
        expect(content).toContain("duplicate key error");
        expect(content).toContain(insertedIds[0]?.toString());
    });

    validateAutoConnectBehavior(integration, "insert-many", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1" }],
            },
            expectedResponse: `Inserted \`1\` document(s) into ${integration.randomDbName()}.coll1.`,
        };
    });
});

describeWithMongoDB(
    "insertMany tool when search is enabled",
    (integration) => {
        let collection: Collection;
        let database: string;

        beforeEach(async () => {
            await integration.connectMcpClient();
            database = integration.randomDbName();
            collection = await integration.mongoClient().db(database).createCollection("test");
            await waitUntilSearchIsReady(integration.mongoClient());
        });

        afterEach(async () => {
            await collection.drop();
        });

        it("inserts a document when the embedding is correct", async () => {
            await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                {
                    type: "vector",
                    path: "embedding",
                    numDimensions: 8,
                    similarity: "euclidean",
                    quantization: "scalar",
                },
            ]);

            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database,
                    collection: "test",
                    documents: [{ embedding: [1, 2, 3, 4, 5, 6, 7, 8] }],
                },
            });

            const content = getResponseContent(response.content);
            const insertedIds = extractInsertedIds(content);
            expect(insertedIds).toHaveLength(1);

            const docCount = await collection.countDocuments({ _id: insertedIds[0] });
            expect(docCount).toBe(1);
        });

        it("returns an error when there is a search index and quantisation is wrong", async () => {
            await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                {
                    type: "vector",
                    path: "embedding",
                    numDimensions: 8,
                    similarity: "euclidean",
                    quantization: "scalar",
                },
            ]);

            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database: database,
                    collection: "test",
                    documents: [{ embedding: "oopsie" }],
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toContain("Error running insert-many");
            const untrustedContent = getDataFromUntrustedContent(content);
            expect(untrustedContent).toContain(
                "- Field embedding is an embedding with 8 dimensions and scalar quantization, and the provided value is not compatible. Actual dimensions: unknown, actual quantization: unknown. Error: not-a-vector"
            );

            const oopsieCount = await collection.countDocuments({
                embedding: "oopsie",
            });
            expect(oopsieCount).toBe(0);
        });

        describe.skipIf(!process.env.TEST_MDB_MCP_VOYAGE_API_KEY)("embeddings generation with Voyage AI", () => {
            beforeEach(async () => {
                await integration.connectMcpClient();
                database = integration.randomDbName();
                collection = await integration.mongoClient().db(database).createCollection("test");
                await waitUntilSearchIsReady(integration.mongoClient());
            });

            afterEach(async () => {
                await collection.drop();
            });

            it("generates embeddings for a single document with one field", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [{ title: "The Matrix" }],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [{ titleEmbeddings: "The Matrix" }],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(1);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(doc).toBeDefined();
                expect(doc?.title).toBe("The Matrix");
                expect(doc?.titleEmbeddings).toBeDefined();
                expect(Array.isArray(doc?.titleEmbeddings)).toBe(true);
                expect((doc?.titleEmbeddings as number[]).length).toBe(1024);
                // Verify all values are numbers
                expect((doc?.titleEmbeddings as number[]).every((n) => typeof n === "number")).toBe(true);
            });

            it("generates embeddings for multiple documents with the same field", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database: database,
                        collection: "test",
                        documents: [
                            {
                                title: "The Matrix",
                            },
                            {
                                title: "Blade Runner",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [
                                {
                                    titleEmbeddings: "The Matrix",
                                },
                                {
                                    titleEmbeddings: "Blade Runner",
                                },
                            ],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(2);

                const doc1 = await collection.findOne({ _id: insertedIds[0] });
                expect(doc1?.title).toBe("The Matrix");
                expect(Array.isArray(doc1?.titleEmbeddings)).toBe(true);
                expect((doc1?.titleEmbeddings as number[]).length).toBe(1024);

                const doc2 = await collection.findOne({ _id: insertedIds[1] });
                expect(doc2?.title).toBe("Blade Runner");
                expect(Array.isArray(doc2?.titleEmbeddings)).toBe(true);
                expect((doc2?.titleEmbeddings as number[]).length).toBe(1024);

                // Verify embeddings are different
                expect(doc1?.titleEmbeddings).not.toEqual(doc2?.titleEmbeddings);
            });

            it("generates embeddings for nested fields", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "info.titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [
                            {
                                info: {
                                    title: "The Matrix",
                                },
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [
                                {
                                    "info.titleEmbeddings": "The Matrix",
                                },
                            ],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(1);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(doc?.info).toBeDefined();
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                expect(doc?.info.title).toBe("The Matrix");
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                expect(Array.isArray(doc?.info.titleEmbeddings)).toBe(true);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                expect((doc?.info.titleEmbeddings as number[]).length).toBe(1024);
            });

            it("overwrites existing field value with generated embeddings", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [
                            {
                                title: "The Matrix",
                                titleEmbeddings: [1, 2, 3], // This should be overwritten
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [
                                {
                                    titleEmbeddings: "The Matrix",
                                },
                            ],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(1);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(doc?.title).toBe("The Matrix");
                expect(doc?.titleEmbeddings).not.toEqual([1, 2, 3]);
                expect(Array.isArray(doc?.titleEmbeddings)).toBe(true);
                expect((doc?.titleEmbeddings as number[]).length).toBe(1024);
            });

            it("removes redundant nested field from document when embeddings are generated", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "title.embeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [{ title: { text: "The Matrix", embeddings: "This should be removed" } }],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [{ "title.embeddings": "The Matrix" }],
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(1);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect((doc?.title as Record<string, unknown>)?.text).toBe("The Matrix");
                expect((doc?.title as Record<string, unknown>)?.embeddings).not.toBeDefined();
                expect((doc?.["title.embeddings"] as unknown as number[]).length).toBe(1024);
            });

            it("returns an error when input field does not have a vector search index", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [
                            {
                                title: "The Matrix",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [
                                {
                                    nonExistentField: "The Matrix",
                                },
                            ],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Error running insert-many");
                expect(content).toContain("Field 'nonExistentField' does not have a vector search index in collection");
                expect(content).toContain("Only fields with vector search indexes can have embeddings generated");
            });

            it("inserts documents without embeddings when input array is empty", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [
                            {
                                title: "The Matrix",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);
                expect(insertedIds).toHaveLength(1);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(doc?.title).toBe("The Matrix");
                expect(doc?.titleEmbeddings).toBeUndefined();
            });

            it("generates embeddings with 256 dimensions", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 256,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [{ title: "The Matrix" }],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            outputDimension: 256,
                            input: [{ titleEmbeddings: "The Matrix" }],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(Array.isArray(doc?.titleEmbeddings)).toBe(true);
                expect((doc?.titleEmbeddings as number[]).length).toBe(256);
            });

            it("generates embeddings for multiple fields in a single document", async () => {
                await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                    {
                        type: "vector",
                        path: "titleEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                    {
                        type: "vector",
                        path: "plotEmbeddings",
                        numDimensions: 1024,
                        similarity: "cosine",
                        quantization: "scalar",
                    },
                ]);

                const response = await integration.mcpClient().callTool({
                    name: "insert-many",
                    arguments: {
                        database,
                        collection: "test",
                        documents: [
                            {
                                title: "The Matrix",
                                plot: "A computer hacker learns about the true nature of his reality",
                            },
                        ],
                        embeddingParameters: {
                            model: "voyage-3.5-lite",
                            input: [
                                {
                                    titleEmbeddings: "The Matrix",
                                    plotEmbeddings: "A computer hacker learns about the true nature of his reality",
                                },
                            ],
                        },
                    },
                });

                const content = getResponseContent(response.content);
                expect(content).toContain("Documents were inserted successfully.");
                const insertedIds = extractInsertedIds(content);

                const doc = await collection.findOne({ _id: insertedIds[0] });
                expect(doc?.title).toBe("The Matrix");
                expect(Array.isArray(doc?.titleEmbeddings)).toBe(true);
                expect((doc?.titleEmbeddings as number[]).length).toBe(1024);
                expect(Array.isArray(doc?.plotEmbeddings)).toBe(true);
                expect((doc?.plotEmbeddings as number[]).length).toBe(1024);
                // Verify embeddings are different for different text
                expect(doc?.titleEmbeddings).not.toEqual(doc?.plotEmbeddings);
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            voyageApiKey: process.env.TEST_MDB_MCP_VOYAGE_API_KEY ?? "",
            previewFeatures: ["vectorSearch"],
        }),
        downloadOptions: { search: true },
    }
);

describeWithMongoDB(
    "insertMany tool when vector search is enabled",
    (integration) => {
        validateToolMetadata(integration, "insert-many", "Insert an array of documents into a MongoDB collection", [
            ...databaseCollectionParameters,
            {
                name: "documents",
                type: "array",
                description:
                    "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany().",
                required: true,
            },
            {
                name: "embeddingParameters",
                type: "object",
                description:
                    "The embedding model and its parameters to use to generate embeddings for fields with vector search indexes. Note to LLM: If unsure which embedding model to use, ask the user before providing one.",
                required: false,
            },
        ]);
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            voyageApiKey: "valid-key",
            previewFeatures: ["vectorSearch"],
        }),
    }
);

function extractInsertedIds(content: string): ObjectId[] {
    expect(content).toContain("Documents were inserted successfully.");
    expect(content).toContain("Inserted IDs:");

    const match = content.match(/Inserted IDs:\s(.*)/);
    const group = match?.[1];
    return (
        group
            ?.split(",")
            .map((e) => e.trim())
            .map((e) => ObjectId.createFromHexString(e)) ?? []
    );
}
