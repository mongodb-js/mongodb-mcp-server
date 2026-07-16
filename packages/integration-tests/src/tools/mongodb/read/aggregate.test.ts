import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseContent,
    defaultTestConfig,
    expectDefined,
} from "../../../integrationHelpers.js";
import {
    describeWithMongoDB,
    getDocsFromUntrustedContent,
    validateAutoConnectBehavior,
    createVectorSearchIndexAndWait,
    syncMongoToolsConfigFromUserConfig,
    waitUntilSearchIndexIsQueryable,
    waitUntilSearchIsReady,
} from "../../../mongodbHelpers.js";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { freshInsertDocuments } from "./helpers.js";
import { BSON } from "bson";
import { DOCUMENT_EMBEDDINGS } from "./vyai/embeddings.js";
import type { TelemetryToolEvent as ToolEvent } from "@mongodb-js/mcp-atlas-telemetry";
import type { Client } from "@modelcontextprotocol/sdk/client";
import { QUERY_COUNT_MAX_TIME_MS_CAP, pipelineDescriptionWithVectorSearch } from "@mongodb-js/mcp-tools-mongodb";
import { MongoServerError } from "mongodb";
import type { Collection } from "mongodb";

describeWithMongoDB("aggregate tool", (integration) => {
    afterEach(() => {
        integration.mcpServer().session.config.readOnly = false;
        integration.mcpServer().session.config.disabledTools = [];
        syncMongoToolsConfigFromUserConfig(integration.mcpServer());
    });

    validateToolMetadata(integration, "aggregate", "Run an aggregation against a MongoDB collection", "read", [
        ...databaseCollectionParameters,
        {
            name: "pipeline",
            description: pipelineDescriptionWithVectorSearch,
            type: "array",
            required: true,
        },
        {
            name: "responseBytesLimit",
            description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded. Note to LLM: If the entire aggregation result is required, use the "export" tool instead of increasing this limit.`,
            type: "number",
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "aggregate", [
        {},
        { database: "test", collection: "foo" },
        { database: "test", pipeline: [] },
        { database: "test", collection: "foo", pipeline: {} },
        { database: "test", collection: [], pipeline: [] },
        { database: 123, collection: "foo", pipeline: [] },
    ]);

    it("can run aggregation on non-existent database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: { database: "non-existent", collection: "people", pipeline: [{ $match: { name: "Peter" } }] },
        });

        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation resulted in 0 documents.");
    });

    it("can run aggregation on an empty collection", async () => {
        await integration.mongoClient().db(integration.randomDbName()).createCollection("people");

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $match: { name: "Peter" } }],
            },
        });

        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation resulted in 0 documents.");
    });

    it("can run aggregation on an existing collection", async () => {
        const mongoClient = integration.mongoClient();
        await mongoClient
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
                { name: "Søren", age: 15 },
            ]);

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $match: { age: { $gt: 8 } } }, { $sort: { name: -1 } }],
            },
        });

        const content = getResponseContent(response);
        expect(content).toContain("The aggregation resulted in 2 documents");
        const docs = getDocsFromUntrustedContent(content);
        expect(docs[0]).toEqual(
            expect.objectContaining({
                _id: expect.any(Object) as object,
                name: "Søren",
                age: 15,
            })
        );
        expect(docs[1]).toEqual(
            expect.objectContaining({
                _id: expect.any(Object) as object,
                name: "Laura",
                age: 10,
            })
        );
    });

    it("can not run $out stages in readOnly mode", async () => {
        await integration.connectMcpClient();
        integration.mcpServer().session.config.readOnly = true;
        syncMongoToolsConfigFromUserConfig(integration.mcpServer());
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $out: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual(
            "Error running aggregate: In readOnly mode you can not run pipelines with $out or $merge stages."
        );
    });

    it("can not run $merge stages in readOnly mode", async () => {
        await integration.connectMcpClient();
        integration.mcpServer().session.config.readOnly = true;
        syncMongoToolsConfigFromUserConfig(integration.mcpServer());
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $merge: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual(
            "Error running aggregate: In readOnly mode you can not run pipelines with $out or $merge stages."
        );
    });

    it("can run $limit stages with a small number", async () => {
        const mongoClient = integration.mongoClient();
        await mongoClient
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
                { name: "Søren", age: 15 },
            ]);

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $limit: 1 }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toContain("The aggregation resulted in 1 documents");
    });

    it("can run $out stages in non-readonly mode", async () => {
        const mongoClient = integration.mongoClient();
        await mongoClient
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
                { name: "Søren", age: 15 },
            ]);
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $out: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation pipeline executed successfully.");

        const copiedDocs = await mongoClient.db(integration.randomDbName()).collection("outpeople").find().toArray();
        expect(copiedDocs).toHaveLength(3);
        expect(copiedDocs.map((doc) => doc.name as string)).toEqual(["Peter", "Laura", "Søren"]);
    });

    it("can run $merge stages in non-readonly mode", async () => {
        const mongoClient = integration.mongoClient();
        await mongoClient
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
                { name: "Søren", age: 15 },
            ]);
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $merge: "mergedpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation pipeline executed successfully.");

        const mergedDocs = await mongoClient.db(integration.randomDbName()).collection("mergedpeople").find().toArray();
        expect(mergedDocs).toHaveLength(3);
        expect(mergedDocs.map((doc) => doc.name as string)).toEqual(["Peter", "Laura", "Søren"]);
    });

    it("should emit tool event without auto-embedding usage metadata", async () => {
        const mockEmitEvents = vi.spyOn(integration.mcpServer()["telemetry"], "emitEvents");
        vi.spyOn(integration.mcpServer()["telemetry"], "isTelemetryEnabled").mockReturnValue(true);

        const mongoClient = integration.mongoClient();
        await mongoClient
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
                { name: "Søren", age: 15 },
            ]);

        await integration.connectMcpClient();
        await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $match: { age: { $gt: 8 } } }, { $sort: { name: -1 } }],
            },
        });

        expect(mockEmitEvents).toHaveBeenCalled();
        const emittedEvent = (mockEmitEvents.mock.lastCall?.[0] as ToolEvent[] | undefined)?.[0];
        expectDefined(emittedEvent);
        expect(emittedEvent.properties.embeddingsGeneratedBy).toBeUndefined();
    });

    for (const disabledOpType of ["create", "update", "delete"] as const) {
        it(`can not run $out stages when ${disabledOpType} operation is disabled`, async () => {
            await integration.connectMcpClient();
            integration.mcpServer().session.config.disabledTools = [disabledOpType];
            syncMongoToolsConfigFromUserConfig(integration.mcpServer());
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $out: "outpeople" }],
                },
            });
            const content = getResponseContent(response);
            expect(content).toEqual(
                "Error running aggregate: When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages."
            );
        });

        it(`can not run $merge stages when ${disabledOpType} operation is disabled`, async () => {
            await integration.connectMcpClient();
            integration.mcpServer().session.config.disabledTools = [disabledOpType];
            syncMongoToolsConfigFromUserConfig(integration.mcpServer());
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $merge: "outpeople" }],
                },
            });
            const content = getResponseContent(response);
            expect(content).toEqual(
                "Error running aggregate: When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages."
            );
        });
    }

    describe("when getSearchIndexes throws after a successful search capability probe", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("should succeed for non-search aggregations", async () => {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("people")
                .insertMany([{ name: "Alice" }, { name: "Bob" }]);

            await integration.connectMcpClient();

            vi.spyOn(integration.mcpServer().session, "isSearchSupported").mockResolvedValue(true);
            vi.spyOn(integration.mcpServer().session.serviceProvider, "getSearchIndexes").mockRejectedValue(
                new MongoServerError({ message: "Error connecting to Search Index Management service" })
            );

            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { name: "Alice" } }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 1 documents");
            const docs = getDocsFromUntrustedContent<{ name: string }>(content);
            expect(docs[0]?.name).toBe("Alice");
        });

        it("should skip pre-filter validation and let the server decide for $vectorSearch aggregations", async () => {
            await integration.connectMcpClient();

            vi.spyOn(integration.mcpServer().session, "isSearchSupported").mockResolvedValue(true);
            vi.spyOn(integration.mcpServer().session.serviceProvider, "getSearchIndexes").mockRejectedValue(
                new MongoServerError({ message: "Error connecting to Search Index Management service" })
            );

            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [
                        {
                            $vectorSearch: {
                                index: "myIndex",
                                path: "embedding",
                                queryVector: [1, 2, 3],
                                numCandidates: 10,
                                limit: 5,
                                filter: { category: "electronics" },
                            },
                        },
                    ],
                },
            });

            const content = getResponseContent(response);
            expect(content).not.toContain("Vector search stage contains filter on fields that are not indexed");
        });
    });

    validateAutoConnectBehavior(integration, "aggregate", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                pipeline: [{ $match: { name: "Liva" } }],
            },
            expectedResponse: "The aggregation resulted in 0 documents",
        };
    });
});

describeWithMongoDB(
    "aggregate tool — aggregation count maxTimeMS runtime override",
    (integration) => {
        describe("when counting documents exceed the configured count maxTimeMS", () => {
            beforeEach(async () => {
                await freshInsertDocuments({
                    collection: integration.mongoClient().db(integration.randomDbName()).collection("people"),
                    count: 1000,
                    documentMapper(index) {
                        return { name: `Person ${index}`, age: index };
                    },
                });
            });

            afterEach(() => {
                vi.resetAllMocks();
            });

            it("should abort count operation and respond with indeterminable count", async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "aggregate",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "people",
                        pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { name: -1 } }],
                    },
                });
                const content = getResponseContent(response);
                expect(content).toContain("The aggregation resulted in indeterminable number of documents");
                expect(content).toContain(`Returning 100 documents.`);
                const docs = getDocsFromUntrustedContent(content);
                expect(docs[0]).toEqual(
                    expect.objectContaining({
                        _id: expect.any(Object) as object,
                        name: "Person 999",
                        age: 999,
                    })
                );
                expect(docs[1]).toEqual(
                    expect.objectContaining({
                        _id: expect.any(Object) as object,
                        name: "Person 998",
                        age: 998,
                    })
                );
            });
        });
    },
    {
        getUserConfig: (mdbIntegration) => ({
            ...structuredClone(defaultTestConfig),
            connectionString: mdbIntegration.connectionString(),
            queryCountMaxTimeMsCap: QUERY_COUNT_MAX_TIME_MS_CAP,
            aggregationCountMaxTimeMsCap: 0.1,
        }),
    }
);

describeWithMongoDB(
    "aggregate tool with configured max documents per query",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("people"),
                count: 1000,
                documentMapper(index) {
                    return { name: `Person ${index}`, age: index };
                },
            });
        });

        const validateDocs = (docs: unknown[], expectedLength: number): void => {
            expect(docs).toHaveLength(expectedLength);

            const expectedObjects = Array.from({ length: expectedLength }).map((_, idx) => ({
                name: `Person ${999 - idx}`,
                age: 999 - idx,
            }));

            expect((docs as { name: string; age: number }[]).map((doc) => ({ name: doc.name, age: doc.age }))).toEqual(
                expectedObjects
            );
        };

        it("should return documents limited to the configured limit without $limit stage", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { age: -1 } }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 990 documents");
            expect(content).toContain(
                `Returning 20 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`
            );
            const docs = getDocsFromUntrustedContent(content);
            validateDocs(docs, 20);
        });

        it("should return documents limited to the configured limit with $limit stage larger than the configured", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { age: -1 } }, { $limit: 50 }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 50 documents");
            expect(content).toContain(
                `Returning 20 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`
            );
            const docs = getDocsFromUntrustedContent(content);
            validateDocs(docs, 20);
        });

        it("should return documents limited to the $limit stage when smaller than the configured limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { age: -1 } }, { $limit: 5 }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 5 documents");

            const docs = getDocsFromUntrustedContent(content);
            validateDocs(docs, 5);
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: 20 }),
    }
);

describeWithMongoDB(
    "aggregate tool with configured max bytes per query",
    (integration) => {
        it("should return only the documents that could fit in maxBytesPerQuery limit", async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("people"),
                count: 1000,
                documentMapper(index) {
                    return { name: `Person ${index}`, age: index };
                },
            });
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { name: -1 } }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 990 documents");
            expect(content).toContain(
                `Returning 3 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, server's configured - maxBytesPerQuery.`
            );
        });

        it("should return only the documents that could fit in responseBytesLimit", async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("people"),
                count: 1000,
                documentMapper(index) {
                    return { name: `Person ${index}`, age: index };
                },
            });
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { name: -1 } }],
                    responseBytesLimit: 100,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 990 documents");
            expect(content).toContain(
                `Returning 1 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, tool's parameter - responseBytesLimit.`
            );
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxBytesPerQuery: 200 }),
    }
);

describeWithMongoDB(
    "aggregate tool with disabled max documents and max bytes per query",
    (integration) => {
        it("should return all the documents that could fit in responseBytesLimit", async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("people"),
                count: 1000,
                documentMapper(index) {
                    return { name: `Person ${index}`, age: index };
                },
            });
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    pipeline: [{ $match: { age: { $gte: 10 } } }, { $sort: { name: -1 } }],
                    responseBytesLimit: 1 * 1024 * 1024, // 1MB
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 990 documents");
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: -1, maxBytesPerQuery: -1 }),
    }
);

describeWithMongoDB(
    "aggregate tool with atlas search enabled",
    (integration) => {
        beforeEach(async () => {
            await integration.mongoClient().db(integration.randomDbName()).collection("databases").drop();
        });

        afterEach(() => {
            vi.clearAllMocks();
        });

        validateToolMetadata(integration, "aggregate", "Run an aggregation against a MongoDB collection", "read", [
            ...databaseCollectionParameters,
            {
                name: "pipeline",
                description: pipelineDescriptionWithVectorSearch,
                type: "array",
                required: true,
            },
            {
                name: "responseBytesLimit",
                description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded. Note to LLM: If the entire aggregation result is required, use the "export" tool instead of increasing this limit.`,
                type: "number",
                required: false,
            },
        ]);

        it("should throw an exception when using an index that does not exist", async () => {
            await waitUntilSearchIsReady(integration.mongoClient());

            const collection = integration.mongoClient().db(integration.randomDbName()).collection("databases");

            await collection.insertOne({ name: "mongodb", description_embedding: [1, 2, 3, 4] });
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "databases",
                    pipeline: [
                        {
                            $vectorSearch: {
                                index: "non_existing",
                                path: "description_embedding",
                                queryVector: "example",
                                numCandidates: 10,
                                limit: 10,
                                embeddingParameters: {
                                    model: "voyage-3-large",
                                    outputDimension: "256",
                                },
                            },
                        },
                        {
                            $project: {
                                description_embedding: 0,
                            },
                        },
                    ],
                },
            });

            const responseContent = getResponseContent(response);
            expect(responseContent).toContain(
                `Error running aggregate: Could not find an index with name "non_existing" in namespace "${integration.randomDbName()}.databases".`
            );
        });

        for (const [dataType, embedding] of Object.entries(DOCUMENT_EMBEDDINGS)) {
            for (const similarity of ["euclidean", "cosine", "dotProduct"]) {
                describe(`querying with dataType ${dataType} and similarity ${similarity}`, () => {
                    it(`should be able to return elements from within a vector search query with data type ${dataType}`, async () => {
                        await waitUntilSearchIsReady(integration.mongoClient());

                        const collection = integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("databases");

                        await collection.insertOne({ name: "mongodb", description_embedding: embedding });

                        await createVectorSearchIndexAndWait(
                            integration.mongoClient(),
                            integration.randomDbName(),
                            "databases",
                            [
                                {
                                    type: "vector",
                                    path: "description_embedding",
                                    numDimensions: 256,
                                    similarity,
                                    quantization: "none",
                                },
                            ]
                        );

                        // now query the index
                        await integration.connectMcpClient();
                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "databases",
                                pipeline: [
                                    {
                                        $vectorSearch: {
                                            index: "default",
                                            path: "description_embedding",
                                            queryVector: embedding,
                                            numCandidates: 10,
                                            limit: 10,
                                            embeddingParameters: {
                                                model: "voyage-3-large",
                                                outputDimension: "256",
                                                outputDType: dataType,
                                            },
                                        },
                                    },
                                    {
                                        $project: {
                                            description_embedding: 0,
                                        },
                                    },
                                ],
                            },
                        });

                        const responseContent = getResponseContent(response);
                        expect(responseContent).toContain("The aggregation resulted in 1 documents.");
                        const untrustedDocs = getDocsFromUntrustedContent<{ name: string }>(responseContent);
                        expect(untrustedDocs).toHaveLength(1);
                        expect(untrustedDocs[0]?.name).toBe("mongodb");
                    });

                    it("should be able to return elements from within a vector search query using binary encoding", async () => {
                        await waitUntilSearchIsReady(integration.mongoClient());

                        const collection = integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("databases");
                        await collection.insertOne({
                            name: "mongodb",
                            description_embedding: BSON.Binary.fromFloat32Array(new Float32Array(embedding)),
                        });

                        await createVectorSearchIndexAndWait(
                            integration.mongoClient(),
                            integration.randomDbName(),
                            "databases",
                            [
                                {
                                    type: "vector",
                                    path: "description_embedding",
                                    numDimensions: 256,
                                    similarity,
                                    quantization: "none",
                                },
                            ]
                        );

                        // now query the index
                        await integration.connectMcpClient();
                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "databases",
                                pipeline: [
                                    {
                                        $vectorSearch: {
                                            index: "default",
                                            path: "description_embedding",
                                            queryVector: embedding,
                                            numCandidates: 10,
                                            limit: 10,
                                            embeddingParameters: {
                                                model: "voyage-3-large",
                                                outputDimension: "256",
                                                outputDType: dataType,
                                            },
                                        },
                                    },
                                    {
                                        $project: {
                                            description_embedding: 0,
                                        },
                                    },
                                ],
                            },
                        });

                        const responseContent = getResponseContent(response);
                        expect(responseContent).toContain("The aggregation resulted in 1 documents.");
                        const untrustedDocs = getDocsFromUntrustedContent<{ name: string }>(responseContent);
                        expect(untrustedDocs).toHaveLength(1);
                        expect(untrustedDocs[0]?.name).toBe("mongodb");
                    });

                    it("should be able too return elements from within a vector search query using scalar quantization", async () => {
                        await waitUntilSearchIsReady(integration.mongoClient());

                        const collection = integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("databases");
                        await collection.insertOne({
                            name: "mongodb",
                            description_embedding: BSON.Binary.fromFloat32Array(new Float32Array(embedding)),
                        });

                        await createVectorSearchIndexAndWait(
                            integration.mongoClient(),
                            integration.randomDbName(),
                            "databases",
                            [
                                {
                                    type: "vector",
                                    path: "description_embedding",
                                    numDimensions: 256,
                                    similarity,
                                    quantization: "scalar",
                                },
                            ]
                        );

                        // now query the index
                        await integration.connectMcpClient();
                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "databases",
                                pipeline: [
                                    {
                                        $vectorSearch: {
                                            index: "default",
                                            path: "description_embedding",
                                            queryVector: embedding,
                                            numCandidates: 10,
                                            limit: 10,
                                            embeddingParameters: {
                                                model: "voyage-3-large",
                                                outputDimension: "256",
                                                outputDType: dataType,
                                            },
                                        },
                                    },
                                    {
                                        $project: {
                                            description_embedding: 0,
                                        },
                                    },
                                ],
                            },
                        });

                        const responseContent = getResponseContent(response);
                        expect(responseContent).toContain("The aggregation resulted in 1 documents.");
                        const untrustedDocs = getDocsFromUntrustedContent<{ name: string }>(responseContent);
                        expect(untrustedDocs).toHaveLength(1);
                        expect(untrustedDocs[0]?.name).toBe("mongodb");
                    });

                    it("should be able too return elements from within a vector search query using binary quantization", async () => {
                        await waitUntilSearchIsReady(integration.mongoClient());

                        const collection = integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("databases");
                        await collection.insertOne({
                            name: "mongodb",
                            description_embedding: BSON.Binary.fromFloat32Array(new Float32Array(embedding)),
                        });

                        await createVectorSearchIndexAndWait(
                            integration.mongoClient(),
                            integration.randomDbName(),
                            "databases",
                            [
                                {
                                    type: "vector",
                                    path: "description_embedding",
                                    numDimensions: 256,
                                    similarity,
                                    quantization: "binary",
                                },
                            ]
                        );

                        // now query the index
                        await integration.connectMcpClient();
                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "databases",
                                pipeline: [
                                    {
                                        $vectorSearch: {
                                            index: "default",
                                            path: "description_embedding",
                                            queryVector: embedding,
                                            numCandidates: 10,
                                            limit: 10,
                                            embeddingParameters: {
                                                model: "voyage-3-large",
                                                outputDimension: "256",
                                                outputDType: dataType,
                                            },
                                        },
                                    },
                                    {
                                        $project: {
                                            description_embedding: 0,
                                        },
                                    },
                                ],
                            },
                        });

                        const responseContent = getResponseContent(response);
                        expect(responseContent).toContain("The aggregation resulted in 1 documents.");
                        const untrustedDocs = getDocsFromUntrustedContent<{ name: string }>(responseContent);
                        expect(untrustedDocs).toHaveLength(1);
                        expect(untrustedDocs[0]?.name).toBe("mongodb");
                    });
                });
            }
        }
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            maxDocumentsPerQuery: -1,
            maxBytesPerQuery: -1,
            indexCheck: true,
        }),
        downloadOptions: { search: true },
    }
);

describeWithMongoDB(
    "aggregate tool with abort signal",
    (integration) => {
        beforeEach(async () => {
            // Insert many documents with complex data to simulate a slow query
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("abort_collection"),
                count: 10000,
                documentMapper: (index) => ({
                    _id: index,
                    description: `Document ${index}`,
                    longText: `This is a very long text field for document ${index} `.repeat(100),
                }),
            });
        });

        const runSlowAggregate = async (
            signal?: AbortSignal
        ): Promise<{ executionTime: number; result?: Awaited<ReturnType<Client["callTool"]>>; error?: Error }> => {
            const startTime = performance.now();

            let result: Awaited<ReturnType<Client["callTool"]>> | undefined;
            let error: Error | undefined;
            try {
                result = await integration.mcpClient().callTool(
                    {
                        name: "aggregate",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "abort_collection",
                            pipeline: [
                                // Complex regex matching to slow down the query
                                {
                                    $match: {
                                        longText: { $regex: ".*Document.*very.*long.*text.*", $options: "i" },
                                    },
                                },
                                // Add complex calculations to slow it down further
                                {
                                    $addFields: {
                                        complexCalculation: {
                                            $sum: {
                                                $map: {
                                                    input: { $range: [0, 1000] },
                                                    as: "num",
                                                    in: { $multiply: ["$$num", "$_id"] },
                                                },
                                            },
                                        },
                                    },
                                },
                                // Group and unwind to add more processing
                                {
                                    $group: {
                                        _id: "$_id",
                                        description: { $first: "$description" },
                                        longText: { $first: "$longText" },
                                        complexCalculation: { $first: "$complexCalculation" },
                                    },
                                },
                                { $sort: { complexCalculation: -1 } },
                            ],
                        },
                    },
                    undefined,
                    { signal }
                );
            } catch (err: unknown) {
                error = err as Error;
            }

            const executionTime = performance.now() - startTime;

            return {
                result,
                error,
                executionTime,
            };
        };

        it("should abort aggregate operation when signal is triggered immediately", async () => {
            await integration.connectMcpClient();
            const abortController = new AbortController();

            const aggregatePromise = runSlowAggregate(abortController.signal);

            // Abort immediately
            abortController.abort();

            const { result, error, executionTime } = await aggregatePromise;

            expect(executionTime).toBeLessThan(25); // Ensure it aborted quickly
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should abort aggregate operation during cursor iteration", async () => {
            await integration.connectMcpClient();
            const abortController = new AbortController();

            // Start an aggregation with regex and complex filter that requires scanning many documents
            const aggregatePromise = runSlowAggregate(abortController.signal);

            // Give the cursor a bit of time to start processing, then abort
            setTimeout(() => abortController.abort(), 25);

            const { result, error, executionTime } = await aggregatePromise;

            // Ensure it aborted quickly, but possibly after some processing
            expect(executionTime).toBeGreaterThanOrEqual(25);
            expect(executionTime).toBeLessThan(80);
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should complete successfully when not aborted", async () => {
            await integration.connectMcpClient();

            const { result, error, executionTime } = await runSlowAggregate();

            // Complex regex matching and calculations on 10000 docs should take some time
            expect(executionTime).toBeGreaterThan(100);
            expectDefined(result);
            expect(error).toBeUndefined();
            const content = getResponseContent(result);
            expect(content).toContain("The aggregation resulted in");
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            maxDocumentsPerQuery: 10000,
        }),
    }
);

describeWithMongoDB(
    "aggregate tool with autoEmbed text support",
    (integration) => {
        let collection: Collection;
        beforeEach(async () => {
            await integration.connectMcpClient();
            collection = integration.mongoClient().db(integration.randomDbName()).collection("movies");
            await waitUntilSearchIsReady(integration.mongoClient());

            await collection.insertMany([
                {
                    plot: "An alien gets stranded on earth looking for scientist who contacted them.",
                },
                {
                    plot: "Story of a pizza and how they got famous in Naples.",
                },
            ]);

            // Creating the auto-embed index
            await collection.createSearchIndexes([
                {
                    type: "vectorSearch",
                    name: "auto-embed-index",
                    definition: {
                        fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
                    },
                },
            ]);

            // Auto-embed indexes take longer to build because they need to call the voyage API
            // to generate embeddings for the documents. Using a longer timeout (300s) to tolerate
            // slower CI environments and transient Voyage API latency.
            await waitUntilSearchIndexIsQueryable(collection, "auto-embed-index", 300_000);
        });

        it("should be able to query autoEmbed text index", { timeout: 320_000 }, async () => {
            const response = await integration.mcpClient().callTool({
                name: "aggregate",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "movies",
                    pipeline: [
                        {
                            $vectorSearch: {
                                index: "auto-embed-index",
                                path: "plot",
                                query: { text: "movies about food" },
                                limit: 5,
                                numCandidates: 5,
                            },
                        },
                    ],
                },
            });

            expect(response.isError).toBeUndefined();
            const content = getResponseContent(response);
            expect(content).toContain("Story of a pizza and how they got famous in Naples.");
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            previewFeatures: [],
            maxDocumentsPerQuery: -1,
            maxBytesPerQuery: -1,
            indexCheck: true,
        }),
        downloadOptions: {
            autoEmbed: true,
            mongotPassword: process.env.MDB_MONGOT_PASSWORD as string,
            voyageIndexingKey: process.env.MDB_VOYAGE_API_KEY as string,
            voyageQueryKey: process.env.MDB_VOYAGE_API_KEY as string,
        },
    }
);
