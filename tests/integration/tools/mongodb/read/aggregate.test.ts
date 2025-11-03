import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseContent,
    defaultTestConfig,
} from "../../../helpers.js";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
    createVectorSearchIndexAndWait,
    describeWithMongoDB,
    getDocsFromUntrustedContent,
    validateAutoConnectBehavior,
    waitUntilSearchIsReady,
} from "../mongodbHelpers.js";
import * as constants from "../../../../../src/helpers/constants.js";
import { freshInsertDocuments } from "./find.test.js";
import { BSON } from "bson";

describeWithMongoDB("aggregate tool", (integration) => {
    afterEach(() => {
        integration.mcpServer().userConfig.readOnly = false;
        integration.mcpServer().userConfig.disabledTools = [];
    });

    validateToolMetadata(integration, "aggregate", "Run an aggregation against a MongoDB collection", [
        ...databaseCollectionParameters,
        {
            name: "pipeline",
            description: `An array of aggregation stages to execute.  
\`$vectorSearch\` **MUST** be the first stage of the pipeline, or the first stage of a \`$unionWith\` subpipeline.
### Usage Rules for \`$vectorSearch\`
- **Unset embeddings:**  
  Unless the user explicitly requests the embeddings, add an \`$unset\` stage **at the end of the pipeline** to remove the embedding field and avoid context limits. **The $unset stage in this situation is mandatory**.
- **Pre-filtering:**
If the user requests additional filtering, include filters in \`$vectorSearch.filter\` only for pre-filter fields in the vector index.
    NEVER include fields in $vectorSearch.filter that are not part of the vector index.
- **Post-filtering:**
    For all remaining filters, add a $match stage after $vectorSearch.
### Note to LLM
- If unsure which fields are filterable, use the collection-indexes tool to determine valid prefilter fields.
- If no requested filters are valid prefilters, omit the filter key from $vectorSearch.`,
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
        expect(content).toEqual("The aggregation resulted in 0 documents. Returning 0 documents.");
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
        expect(content).toEqual("The aggregation resulted in 0 documents. Returning 0 documents.");
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
        integration.mcpServer().userConfig.readOnly = true;
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
        integration.mcpServer().userConfig.readOnly = true;
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

    for (const disabledOpType of ["create", "update", "delete"] as const) {
        it(`can not run $out stages when ${disabledOpType} operation is disabled`, async () => {
            await integration.connectMcpClient();
            integration.mcpServer().userConfig.disabledTools = [disabledOpType];
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
            integration.mcpServer().userConfig.disabledTools = [disabledOpType];
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
            vi.spyOn(constants, "AGG_COUNT_MAX_TIME_MS_CAP", "get").mockReturnValue(0.1);
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
});

describeWithMongoDB(
    "aggregate tool with configured max documents per query",
    (integration) => {
        it("should return documents limited to the configured limit", async () => {
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
                `Returning 20 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`
            );
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
            expect(content).toContain(`Returning 990 documents.`);
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: -1, maxBytesPerQuery: -1 }),
    }
);

import { DOCUMENT_EMBEDDINGS } from "./vyai/embeddings.js";

describeWithMongoDB(
    "aggregate tool with atlas search enabled",
    (integration) => {
        beforeEach(async ({ skip }) => {
            skip(!process.env.TEST_MDB_MCP_VOYAGE_API_KEY);
            await integration.mongoClient().db(integration.randomDbName()).collection("databases").drop();
        });

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
                                    outputDimension: 256,
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
                                                outputDimension: 256,
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
                        expect(responseContent).toContain(
                            "The aggregation resulted in 1 documents. Returning 1 documents."
                        );
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
                                                outputDimension: 256,
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
                        expect(responseContent).toContain(
                            "The aggregation resulted in 1 documents. Returning 1 documents."
                        );
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
                                                outputDimension: 256,
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
                        expect(responseContent).toContain(
                            "The aggregation resulted in 1 documents. Returning 1 documents."
                        );
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
                                                outputDimension: 256,
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
                        expect(responseContent).toContain(
                            "The aggregation resulted in 1 documents. Returning 1 documents."
                        );
                        const untrustedDocs = getDocsFromUntrustedContent<{ name: string }>(responseContent);
                        expect(untrustedDocs).toHaveLength(1);
                        expect(untrustedDocs[0]?.name).toBe("mongodb");
                    });
                });
            }
        }

        describe("when querying with a pre-filter", () => {
            it("should fail the validation if the vector search index does not index any pre-filter fields", async () => {
                await waitUntilSearchIsReady(integration.mongoClient());

                const collection = integration.mongoClient().db(integration.randomDbName()).collection("databases");
                await collection.insertOne({ name: "mongodb", description_embedding: DOCUMENT_EMBEDDINGS.float });

                await createVectorSearchIndexAndWait(
                    integration.mongoClient(),
                    integration.randomDbName(),
                    "databases",
                    [
                        {
                            type: "vector",
                            path: "description_embedding",
                            numDimensions: 256,
                            similarity: "euclidean",
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
                                    queryVector: DOCUMENT_EMBEDDINGS.float,
                                    numCandidates: 10,
                                    limit: 10,
                                    embeddingParameters: {
                                        model: "voyage-3-large",
                                        outputDimension: 256,
                                        outputDType: "float",
                                    },
                                    filter: { name: 10 },
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

                expect(response.isError).toBe(true);
                expect(JSON.stringify(response.content)).toContain(
                    "Error running aggregate: Vector search stage contains filter on fields that are not indexed by index default - name"
                );
            });

            it("should fail the validation if the pre-filter are not indexed as part of vector search index", async () => {
                await waitUntilSearchIsReady(integration.mongoClient());

                const collection = integration.mongoClient().db(integration.randomDbName()).collection("databases");
                await collection.insertOne({ name: "mongodb", description_embedding: DOCUMENT_EMBEDDINGS.float });

                await createVectorSearchIndexAndWait(
                    integration.mongoClient(),
                    integration.randomDbName(),
                    "databases",
                    [
                        {
                            type: "vector",
                            path: "description_embedding",
                            numDimensions: 256,
                            similarity: "euclidean",
                            quantization: "none",
                        },
                        {
                            type: "filter",
                            path: "year",
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
                                    queryVector: DOCUMENT_EMBEDDINGS.float,
                                    numCandidates: 10,
                                    limit: 10,
                                    embeddingParameters: {
                                        model: "voyage-3-large",
                                        outputDimension: 256,
                                        outputDType: "float",
                                    },
                                    filter: { name: 10 },
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

                expect(response.isError).toBe(true);
                expect(JSON.stringify(response.content)).toContain(
                    "Error running aggregate: Vector search stage contains filter on fields that are not indexed by index default - name"
                );
            });

            it("should succeed the validation if the pre-filter are also indexed as part of vector search index", async () => {
                await waitUntilSearchIsReady(integration.mongoClient());

                const collection = integration.mongoClient().db(integration.randomDbName()).collection("databases");
                await collection.insertOne({ name: "mongodb", description_embedding: DOCUMENT_EMBEDDINGS.float });

                await createVectorSearchIndexAndWait(
                    integration.mongoClient(),
                    integration.randomDbName(),
                    "databases",
                    [
                        {
                            type: "vector",
                            path: "description_embedding",
                            numDimensions: 256,
                            similarity: "euclidean",
                            quantization: "none",
                        },
                        {
                            type: "filter",
                            path: "name",
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
                                    queryVector: DOCUMENT_EMBEDDINGS.float,
                                    numCandidates: 10,
                                    limit: 10,
                                    embeddingParameters: {
                                        model: "voyage-3-large",
                                        outputDimension: 256,
                                        outputDType: "float",
                                    },
                                    filter: { name: 10 },
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

                expect(!!response.isError).toBe(false);
                expect(JSON.stringify(response.content)).toContain(
                    "The aggregation resulted in 0 documents. Returning 0 documents."
                );
            });
        });
    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            voyageApiKey: process.env.TEST_MDB_MCP_VOYAGE_API_KEY ?? "",
            previewFeatures: ["vectorSearch"],
            maxDocumentsPerQuery: -1,
            maxBytesPerQuery: -1,
            indexCheck: true,
        }),
        downloadOptions: { search: true },
    }
);
