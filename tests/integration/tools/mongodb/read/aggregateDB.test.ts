import {
    databaseParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseContent,
    defaultTestConfig,
    expectDefined,
} from "../../../helpers.js";
import { expect, it, afterEach } from "vitest";
import { describeWithMongoDB, getDocsFromUntrustedContent, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import type { Client } from "@modelcontextprotocol/sdk/client";

describeWithMongoDB("aggregate-db tool", (integration) => {
    afterEach(() => {
        integration.mcpServer().userConfig.readOnly = false;
        integration.mcpServer().userConfig.disabledTools = [];
    });

    validateToolMetadata(integration, "aggregate-db", "Run an aggregation against a MongoDB database", "read", [
        ...databaseParameters,
        {
            name: "pipeline",
            description: "An array of aggregation stages to execute.",
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

    validateThrowsForInvalidArguments(integration, "aggregate-db", [
        {},
        { database: "test", collection: "foo" },
        { database: "test", pipeline: {} },
        { database: 123, pipeline: [] },
    ]);

    it("can run aggregation-db on an existing database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: integration.randomDbName(),
                pipeline: [
                    {
                        $documents: [
                            { name: "test1", value: 1 },
                            { name: "test2", value: 2 },
                        ],
                    },
                ],
            },
        });

        const content = getResponseContent(response);
        expect(content).toContain("The aggregation resulted in 2 documents");
        const docs = getDocsFromUntrustedContent(content);
        expect(docs[0]).toEqual({ name: "test1", value: 1 });
        expect(docs[1]).toEqual({ name: "test2", value: 2 });
    });

    it("can run aggregation-db on the admin database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: "admin",
                pipeline: [{ $currentOp: { allUsers: true, idleSessions: true } }, { $limit: 10 }],
            },
        });

        const content = getResponseContent(response);
        expect(content).toMatch(/The aggregation resulted in \d+ documents/);
    });

    it("can not run $out stages in readOnly mode", async () => {
        await integration.connectMcpClient();
        integration.mcpServer().userConfig.readOnly = true;
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: integration.randomDbName(),
                pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $out: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual(
            "Error running aggregate-db: In readOnly mode you can not run pipelines with $out or $merge stages."
        );
    });

    it("can not run $merge stages in readOnly mode", async () => {
        await integration.connectMcpClient();
        integration.mcpServer().userConfig.readOnly = true;
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: integration.randomDbName(),
                pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $merge: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual(
            "Error running aggregate-db: In readOnly mode you can not run pipelines with $out or $merge stages."
        );
    });

    it("can run $out stages in non-readonly mode", async () => {
        const mongoClient = integration.mongoClient();
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: integration.randomDbName(),
                pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $out: "outpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation pipeline executed successfully.");

        const copiedDocs = await mongoClient.db(integration.randomDbName()).collection("outpeople").find().toArray();
        expect(copiedDocs).toHaveLength(1);
        expect(copiedDocs.map((doc) => doc.name as string)).toEqual(["Peter"]);
    });

    it("can run $merge stages in non-readonly mode", async () => {
        const mongoClient = integration.mongoClient();
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate-db",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
                pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $merge: "mergedpeople" }],
            },
        });
        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation pipeline executed successfully.");

        const mergedDocs = await mongoClient.db(integration.randomDbName()).collection("mergedpeople").find().toArray();
        expect(mergedDocs).toHaveLength(1);
        expect(mergedDocs.map((doc) => doc.name as string)).toEqual(["Peter"]);
    });

    for (const disabledOpType of ["create", "update", "delete"] as const) {
        it(`can not run $out stages when ${disabledOpType} operation is disabled`, async () => {
            await integration.connectMcpClient();
            integration.mcpServer().userConfig.disabledTools = [disabledOpType];
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $out: "outpeople" }],
                },
            });
            const content = getResponseContent(response);
            expect(content).toEqual(
                "Error running aggregate-db: When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages."
            );
        });

        it(`can not run $merge stages when ${disabledOpType} operation is disabled`, async () => {
            await integration.connectMcpClient();
            integration.mcpServer().userConfig.disabledTools = [disabledOpType];
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: [{ name: "Peter", age: 5 }] }, { $merge: "outpeople" }],
                },
            });
            const content = getResponseContent(response);
            expect(content).toEqual(
                "Error running aggregate-db: When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages."
            );
        });
    }

    validateAutoConnectBehavior(integration, "aggregate-db", () => {
        return {
            args: {
                database: "admin",
                pipeline: [{ $currentOp: { allUsers: true, idleSessions: true } }, { $limit: 10 }],
            },
            validate: (content): void => {
                expect(getResponseContent(content)).toMatch(/The aggregation resulted in \d+ documents/);
            },
        };
    });
});

describeWithMongoDB(
    "aggregate-db tool with configured max documents per query",
    (integration) => {
        const initialDocsCount = 100;
        const initialDocs = Array.from({ length: initialDocsCount }).map((_, idx) => ({
            name: `Person ${idx}`,
            age: idx,
        }));

        const validateDocs = (docs: unknown[], expectedLength: number): void => {
            expect(docs).toHaveLength(expectedLength);

            const expectedObjects = Array.from({ length: expectedLength }).map((_, idx) => ({
                name: `Person ${initialDocsCount - 1 - idx}`,
                age: initialDocsCount - 1 - idx,
            }));

            expect((docs as { name: string; age: number }[]).map((doc) => ({ name: doc.name, age: doc.age }))).toEqual(
                expectedObjects
            );
        };

        it("should return documents limited to the configured limit without $limit stage", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocs }, { $sort: { age: -1 } }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 100 documents");
            expect(content).toContain(
                `Returning 20 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`
            );
            const docs = getDocsFromUntrustedContent(content);
            validateDocs(docs, 20);
        });

        it("should return documents limited to the configured limit with $limit stage larger than the configured", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocs }, { $sort: { age: -1 } }, { $limit: 50 }],
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
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocs }, { $sort: { age: -1 } }, { $limit: 5 }],
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
    "aggregate-db tool with configured max bytes per query",
    (integration) => {
        const initialDocsCount = 1000;
        const initialDocuments = Array.from({ length: initialDocsCount }).map((_, idx) => ({
            name: `Person ${idx}`,
            age: idx,
        }));

        it("should return only the documents that could fit in maxBytesPerQuery limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocuments }, { $sort: { name: -1 } }],
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 1000 documents");
            expect(content).toContain(
                `Returning 5 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, server's configured - maxBytesPerQuery.`
            );
        });

        it("should return only the documents that could fit in responseBytesLimit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocuments }, { $sort: { name: -1 } }],
                    responseBytesLimit: 100,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 1000 documents");
            expect(content).toContain(
                `Returning 2 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, tool's parameter - responseBytesLimit.`
            );
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxBytesPerQuery: 200 }),
    }
);

describeWithMongoDB(
    "aggregate-db tool with disabled max documents and max bytes per query",
    (integration) => {
        it("should return all the documents that could fit in responseBytesLimit", async () => {
            const initialDocsCount = 1000;
            const initialDocuments = Array.from({ length: initialDocsCount }).map((_, idx) => ({
                name: `Person ${idx}`,
                age: idx,
            }));

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "aggregate-db",
                arguments: {
                    database: integration.randomDbName(),
                    pipeline: [{ $documents: initialDocuments }, { $sort: { name: -1 } }],
                    responseBytesLimit: 1 * 1024 * 1024, // 1MB
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("The aggregation resulted in 1000 documents");
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: -1, maxBytesPerQuery: -1 }),
    }
);

describeWithMongoDB(
    "aggregate-db tool with abort signal",
    (integration) => {
        const initialDocsCount = 1000;
        const initialDocuments = Array.from({ length: initialDocsCount }).map((_, idx) => ({
            _id: idx,
            description: `Document ${idx}`,
            longText: `This is a very long text field for document ${idx} `.repeat(100),
        }));

        const runSlowAggregateDb = async (
            signal?: AbortSignal
        ): Promise<{ executionTime: number; result?: Awaited<ReturnType<Client["callTool"]>>; error?: Error }> => {
            const startTime = performance.now();

            let result: Awaited<ReturnType<Client["callTool"]>> | undefined;
            let error: Error | undefined;
            try {
                result = await integration.mcpClient().callTool(
                    {
                        name: "aggregate-db",
                        arguments: {
                            database: integration.randomDbName(),
                            pipeline: [
                                { $documents: initialDocuments },
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

        it("should abort aggregate-db operation when signal is triggered immediately", async () => {
            await integration.connectMcpClient();
            const abortController = new AbortController();

            const aggregatePromise = runSlowAggregateDb(abortController.signal);

            // Abort immediately
            abortController.abort();

            const { result, error, executionTime } = await aggregatePromise;

            expect(executionTime).toBeLessThan(100); // Ensure it aborted quickly
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should abort aggregate-db operation during cursor iteration", async () => {
            await integration.connectMcpClient();
            const abortController = new AbortController();

            // Start an aggregation with regex and complex filter that requires scanning many documents
            const aggregatePromise = runSlowAggregateDb(abortController.signal);

            // Give the cursor a bit of time to start processing, then abort
            setTimeout(() => abortController.abort(), 25);

            const { result, error, executionTime } = await aggregatePromise;

            // Ensure it aborted quickly, but possibly after some processing
            expect(executionTime).toBeGreaterThanOrEqual(25);
            expect(executionTime).toBeLessThan(250);
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should complete successfully when not aborted", async () => {
            await integration.connectMcpClient();

            const { result, error, executionTime } = await runSlowAggregateDb();

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
