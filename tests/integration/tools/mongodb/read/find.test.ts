import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Document, Collection } from "mongodb";
import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
    defaultTestConfig,
} from "../../../helpers.js";
import * as constants from "../../../../../src/helpers/constants.js";
import {
    describeWithMongoDB,
    getDocsFromUntrustedContent,
    validateAutoConnectBehavior,
    type MongoDBIntegrationTestCase,
} from "../mongodbHelpers.js";
import type { Client } from "@modelcontextprotocol/sdk/client";
import type { CursorLimitKey } from "../../../../../src/helpers/constants.js";
import { bsonToJson } from "../../../../../src/helpers/bsonToJson.js";
import { FindOutputSchema } from "../../../../../src/tools/mongodb/read/find.js";

type FindToolResponse = Awaited<ReturnType<Client["callTool"]>>;

const findStructuredContentSchema = z.object(FindOutputSchema).strict();

function expectFindStructuredContent(
    response: FindToolResponse,
    content: string,
    { count, limits = [], documents }: { count?: number; limits?: CursorLimitKey[]; documents?: unknown[] } = {}
): unknown[] {
    let contentDocs: unknown[];
    try {
        contentDocs = getDocsFromUntrustedContent(content);
    } catch {
        contentDocs = [];
    }

    if (documents !== undefined) {
        expect(contentDocs).toHaveLength(documents.length);
        for (let i = 0; i < documents.length; i++) {
            expect(contentDocs[i]).toEqual(documents[i]);
        }
    }

    expectDefined(response.structuredContent);

    const schemaResult = findStructuredContentSchema.safeParse(response.structuredContent);
    if (!schemaResult.success) {
        expect.fail(
            `structuredContent failed output schema validation:\n${JSON.stringify(schemaResult.error.format(), null, 2)}`
        );
    }

    const expectedStructuredContent: Record<string, unknown> = {
        documents: bsonToJson(contentDocs),
        appliedLimits: limits,
    };

    if (count !== undefined) {
        expectedStructuredContent.queryResultsCount = count;
    }

    expect(response.structuredContent).toEqual(expectedStructuredContent);

    return contentDocs;
}

export async function freshInsertDocuments({
    collection,
    count,
    documentMapper = (index): Document => ({ value: index }),
}: {
    collection: Collection<Document>;
    count: number;
    documentMapper?: (index: number) => Document;
}): Promise<void> {
    await collection.drop();
    const documents = Array.from({ length: count }).map((_, idx) => documentMapper(idx));
    await collection.insertMany(documents);
}

describeWithMongoDB("find tool with default configuration", (integration) => {
    validateToolMetadata(integration, "find", "Run a find query against a MongoDB collection", "read", [
        ...databaseCollectionParameters,

        {
            name: "filter",
            description: "The query filter, matching the syntax of the query argument of db.collection.find()",
            type: "object",
            required: false,
        },
        {
            name: "projection",
            description: "The projection, matching the syntax of the projection argument of db.collection.find()",
            type: "object",
            required: false,
        },
        {
            name: "limit",
            description: "The maximum number of documents to return",
            type: "number",
            required: false,
        },
        {
            name: "sort",
            description:
                "A document, describing the sort order, matching the syntax of the sort argument of cursor.sort(). The keys of the object are the fields to sort on, while the values are the sort directions (1 for ascending, -1 for descending).",
            type: "object",
            required: false,
        },
        {
            name: "responseBytesLimit",
            description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded.`,
            type: "number",
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "find", [
        {},
        { database: 123, collection: "bar" },
        { database: "test", collection: [] },
        { database: "test", collection: "bar", filter: "{ $gt: { foo: 5 } }" },
        { database: "test", collection: "bar", projection: "name" },
        { database: "test", collection: "bar", limit: "10" },
        { database: "test", collection: "bar", sort: [], limit: 10 },
    ]);

    it("returns 0 when database doesn't exist", async () => {
        const connectionId = await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: { connectionId, database: "non-existent", collection: "foos" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Query on collection "foos" resulted in 0 documents. Returning 0 documents.');
        expectFindStructuredContent(response, content, { count: 0, documents: [] });
    });

    it("returns 0 when collection doesn't exist", async () => {
        const connectionId = await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        await mongoClient.db(integration.randomDbName()).collection("bar").insertOne({});
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: { connectionId, database: integration.randomDbName(), collection: "non-existent" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Query on collection "non-existent" resulted in 0 documents. Returning 0 documents.');
        expectFindStructuredContent(response, content, { count: 0, documents: [] });
    });

    describe("with existing database", () => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 10,
            });
        });

        const testCases: {
            name: string;
            filter?: unknown;
            limit?: number;
            projection?: unknown;
            sort?: unknown;
            expected: unknown[];
            expectedTotalCount?: number;
        }[] = [
            {
                name: "returns all documents when no filter is provided",
                expected: Array(10)
                    .fill(0)
                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index })),
                expectedTotalCount: 10,
            },
            {
                name: "returns documents matching the filter",
                filter: { value: { $gt: 5 } },
                expected: Array(4)
                    .fill(0)

                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index + 6 })),
                expectedTotalCount: 4,
            },
            {
                name: "returns documents matching the filter with projection",
                filter: { value: { $gt: 5 } },
                projection: { value: 1, _id: 0 },
                expected: Array(4)
                    .fill(0)
                    .map((_, index) => ({ value: index + 6 })),
                expectedTotalCount: 4,
            },
            {
                name: "returns documents matching the filter with limit",
                filter: { value: { $gt: 5 } },
                limit: 2,
                expected: [
                    { _id: expect.any(Object) as unknown, value: 6 },
                    { _id: expect.any(Object) as unknown, value: 7 },
                ],
                expectedTotalCount: 4,
            },
            {
                name: "returns documents matching the filter with sort",
                filter: {},
                sort: { value: -1 },
                expected: Array(10)
                    .fill(0)
                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index }))
                    .reverse(),
                expectedTotalCount: 10,
            },
        ];

        for (const { name, filter, limit, projection, sort, expected, expectedTotalCount } of testCases) {
            it(name, async () => {
                const connectionId = await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "find",
                    arguments: {
                        connectionId,
                        database: integration.randomDbName(),
                        collection: "foo",
                        filter,
                        limit,
                        projection,
                        sort,
                    },
                });
                const content = getResponseContent(response);
                const expectedCount = expectedTotalCount ?? expected.length;
                expect(content).toContain(`Query on collection "foo" resulted in ${expectedCount} documents.`);

                expectFindStructuredContent(response, content, { count: expectedCount, documents: expected });
            });
        }

        it("can find objects by $oid", async () => {
            const connectionId = await integration.connectMcpClient();

            const fooObject = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("foo")
                .findOne();
            expectDefined(fooObject);

            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    connectionId,
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: { _id: { $oid: fooObject._id } },
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo" resulted in 1 documents.');

            expectFindStructuredContent(response, content, {
                count: 1,
                documents: [expect.objectContaining({ value: fooObject.value as number })],
            });
        });

        it("can find objects by date", async () => {
            const connectionId = await integration.connectMcpClient();

            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("foo_with_dates")
                .insertMany([
                    { date: new Date("2025-05-10"), idx: 0 },
                    { date: new Date("2025-05-11"), idx: 1 },
                ]);

            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    connectionId,
                    database: integration.randomDbName(),
                    collection: "foo_with_dates",
                    filter: { date: { $gt: { $date: "2025-05-10" } } }, // only 2025-05-11 will match
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(
                'Query on collection "foo_with_dates" resulted in 1 documents. Returning 1 documents.'
            );

            const docs = expectFindStructuredContent(response, content, {
                count: 1,
                documents: [expect.objectContaining({ idx: 1 })],
            }) as { date: Date }[];

            expect(docs[0]?.date.toISOString()).toContain("2025-05-11");
        });
    });

    validateAutoConnectBehavior(integration, "find", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: 'Query on collection "coll1" resulted in 0 documents.',
        };
    });

    describe("when counting documents exceed the configured count maxTimeMS", () => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 10,
            });
        });

        afterEach(() => {
            vi.resetAllMocks();
        });

        it("should abort count operation and respond with indeterminable count", async () => {
            vi.spyOn(constants, "QUERY_COUNT_MAX_TIME_MS_CAP", "get").mockReturnValue(0.1);
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { connectionId, database: integration.randomDbName(), collection: "foo" },
            });
            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo" resulted in indeterminable number of documents.');

            expectFindStructuredContent(response, content, {});
        });
    });
});

const findLimitSuites: {
    suiteLabel: string;
    userConfig: { maxDocumentsPerQuery?: number; maxBytesPerQuery?: number };
    cases: {
        name: string;
        arguments: { limit?: number; responseBytesLimit?: number };
        contentContains: string[];
        structured: { count: number; limits?: CursorLimitKey[] };
    }[];
}[] = [
    {
        suiteLabel: "configured max documents per query",
        userConfig: { maxDocumentsPerQuery: 10 },
        cases: [
            {
                name: "should return documents limited to the provided limit when provided limit < configured limit",
                arguments: { limit: 8 },
                contentContains: [`Query on collection "foo" resulted in 1000 documents.`, `Returning 8 documents.`],
                structured: { count: 1000 },
            },
            {
                name: "should return documents limited to the configured max limit when provided limit > configured limit",
                arguments: { limit: 10000 },
                contentContains: [
                    `Query on collection "foo" resulted in 1000 documents.`,
                    `Returning 10 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`,
                ],
                structured: { count: 1000, limits: ["config.maxDocumentsPerQuery"] },
            },
        ],
    },
    {
        suiteLabel: "configured max bytes per query",
        userConfig: { maxBytesPerQuery: 100 },
        cases: [
            {
                name: "should return only the documents that could fit in configured maxBytesPerQuery limit",
                arguments: { limit: 1000 },
                contentContains: [
                    `Query on collection "foo" resulted in 1000 documents.`,
                    `Returning 3 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, server's configured - maxBytesPerQuery`,
                ],
                structured: {
                    count: 1000,
                    limits: ["config.maxDocumentsPerQuery", "config.maxBytesPerQuery"],
                },
            },
            {
                name: "should return only the documents that could fit in provided responseBytesLimit",
                arguments: { limit: 1000, responseBytesLimit: 50 },
                contentContains: [
                    `Query on collection "foo" resulted in 1000 documents.`,
                    `Returning 1 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, tool's parameter - responseBytesLimit.`,
                ],
                structured: {
                    count: 1000,
                    limits: ["config.maxDocumentsPerQuery", "tool.responseBytesLimit"],
                },
            },
        ],
    },
    {
        suiteLabel: "disabled max limit and max bytes per query",
        userConfig: { maxDocumentsPerQuery: -1, maxBytesPerQuery: -1 },
        cases: [
            {
                name: "should return documents limited to the provided limit",
                arguments: { limit: 8 },
                contentContains: [`Query on collection "foo" resulted in 1000 documents.`, `Returning 8 documents.`],
                structured: { count: 1000 },
            },
            {
                name: "should return documents limited to the responseBytesLimit",
                arguments: { limit: 1000, responseBytesLimit: 50 },
                contentContains: [
                    `Query on collection "foo" resulted in 1000 documents.`,
                    `Returning 1 documents while respecting the applied limits of tool's parameter - responseBytesLimit.`,
                ],
                structured: { count: 1000, limits: ["tool.responseBytesLimit"] },
            },
        ],
    },
];

for (const { suiteLabel, userConfig, cases } of findLimitSuites) {
    describeWithMongoDB(
        `find tool with ${suiteLabel}`,
        (integration) => {
            beforeEach(async () => {
                await freshInsertDocuments({
                    collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                    count: 1000,
                });
            });

            for (const { name, arguments: findArgs, contentContains, structured } of cases) {
                it(name, async () => {
                    const connectionId = await integration.connectMcpClient();
                    const response = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: {
                            connectionId,
                            database: integration.randomDbName(),
                            collection: "foo",
                            filter: {},
                            ...findArgs,
                        },
                    });

                    const content = getResponseContent(response);
                    for (const snippet of contentContains) {
                        expect(content).toContain(snippet);
                    }
                    expectFindStructuredContent(response, content, structured);
                });
            }
        },
        {
            getUserConfig: () => ({ ...defaultTestConfig, ...userConfig }),
        }
    );
}

describe("find tool export hint in the applied-limits message", () => {
    // A tiny responseBytesLimit guarantees the result is truncated so the
    // applied-limits portion of the message is always present.
    const truncatingArgs = { limit: 1000, responseBytesLimit: 50 };
    const appliedLimitsSnippet = "while respecting the applied limits of";
    const exportHintSnippet = `use the "export" tool`;

    const callFind = async (integration: MongoDBIntegrationTestCase): Promise<string> => {
        await freshInsertDocuments({
            collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
            count: 1000,
        });
        const connectionId = await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: {
                connectionId,
                database: integration.randomDbName(),
                collection: "foo",
                filter: {},
                ...truncatingArgs,
            },
        });
        return getResponseContent(response);
    };

    describeWithMongoDB(
        "when the export tool is available",
        (integration) => {
            it("points to the export tool for retrieving the full result set", async () => {
                const content = await callFind(integration);
                expect(content).toContain(appliedLimitsSnippet);
                expect(content).toContain(exportHintSnippet);
            });
        },
        {
            getUserConfig: () => ({ ...defaultTestConfig }),
        }
    );

    describeWithMongoDB(
        "when the export tool is disabled (e.g. remote deployment)",
        (integration) => {
            it("reports the applied limits without referencing the export tool", async () => {
                const content = await callFind(integration);
                expect(content).toContain(appliedLimitsSnippet);
                expect(content).not.toContain(exportHintSnippet);
            });
        },
        {
            getUserConfig: () => ({ ...defaultTestConfig, disabledTools: ["export"] }),
        }
    );
});

describeWithMongoDB(
    "find tool with abort signal",
    (integration) => {
        let connectionId: string;

        beforeEach(async () => {
            // Insert many documents with complex data to simulate a slow query
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("abort_collection"),
                count: 10,
                documentMapper: (index) => ({
                    _id: index,
                    description: `Document ${index}`,
                }),
            });
        });

        const runSlowFind = async (
            signal?: AbortSignal
        ): Promise<{ executionTime: number; result?: Awaited<ReturnType<Client["callTool"]>>; error?: Error }> => {
            const startTime = performance.now();

            let result: Awaited<ReturnType<Client["callTool"]>> | undefined;
            let error: Error | undefined;
            try {
                result = await integration.mcpClient().callTool(
                    {
                        name: "find",
                        arguments: {
                            connectionId,
                            database: integration.randomDbName(),
                            collection: "abort_collection",
                            filter: {
                                $where: "function() { sleep(100); return true; }",
                            },
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

        it("should abort find operation when signal is triggered immediately", async () => {
            connectionId = await integration.connectMcpClient();
            const abortController = new AbortController();

            const findPromise = runSlowFind(abortController.signal);

            // Abort immediately
            abortController.abort();

            const { result, error, executionTime } = await findPromise;

            expect(executionTime).toBeLessThan(50); // Ensure it aborted quickly
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should abort find operation during cursor iteration", async () => {
            connectionId = await integration.connectMcpClient();
            const abortController = new AbortController();

            // Start a query with regex and complex filter that requires scanning many documents
            const findPromise = runSlowFind(abortController.signal);

            // Give the cursor a bit of time to start processing, then abort
            setTimeout(() => abortController.abort(), 250);

            const { result, error, executionTime } = await findPromise;

            // Ensure it aborted quickly, but possibly after some processing
            expect(executionTime).toBeGreaterThanOrEqual(250);
            expect(executionTime).toBeLessThan(450);
            expect(result).toBeUndefined();
            expectDefined(error);
            expect(error.message).toContain("This operation was aborted");
        });

        it("should complete successfully when not aborted", async () => {
            connectionId = await integration.connectMcpClient();

            const { result, error, executionTime } = await runSlowFind();

            // 10 docs, each doc processing sleeps 100ms, so total should be around 1s
            expect(executionTime).toBeGreaterThan(1000);
            expectDefined(result);
            expect(error).toBeUndefined();
            const content = getResponseContent(result);
            expect(content).toContain('Query on collection "abort_collection"');
            expect(result?.structuredContent).toBeDefined();
        });
    },
    {
        // The slow-query tests rely on $where, which is a server-side JS operator.
        getUserConfig: () => ({ ...defaultTestConfig, disableServerSideJs: false }),
    }
);

describeWithMongoDB(
    "find tool with configured maxTimeMS",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 5,
            });
        });

        it("should return results when maxTimeMS is sufficient", async () => {
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { connectionId, database: integration.randomDbName(), collection: "foo", filter: {} },
            });

            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo"');
            expectFindStructuredContent(response, content, { count: 5 });
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxTimeMS: 10_000 }),
    }
);

describeWithMongoDB(
    "find tool with low maxTimeMS rejects slow queries",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 5,
            });
        });

        it("should fail when maxTimeMS is too low for a slow query", async () => {
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    connectionId,
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {
                        $where: "function() { sleep(1000); return true; }",
                    },
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain("operation exceeded time limit");
            expect(response.structuredContent).toBeUndefined();
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxTimeMS: 100, disableServerSideJs: false }),
    }
);

describeWithMongoDB("find tool with server-side JavaScript operators", (integration) => {
    afterEach(() => {
        integration.mcpServer().userConfig.disableServerSideJs = true;
    });

    beforeEach(async () => {
        await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection("people")
            .insertMany([
                { name: "Peter", age: 5 },
                { name: "Laura", age: 10 },
            ]);
    });

    for (const jsDisabled of [true, false]) {
        it(`${jsDisabled ? "rejects" : "allows"} filters using $where when disableServerSideJs is ${jsDisabled}`, async () => {
            integration.mcpServer().userConfig.disableServerSideJs = jsDisabled;
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    connectionId,
                    database: integration.randomDbName(),
                    collection: "people",
                    filter: { $where: "function() { return this.age > 8; }" },
                },
            });
            const content = getResponseContent(response);
            if (jsDisabled) {
                expect(content).toContain(`The "$where" operator is not allowed.`);
            } else {
                expect(content).not.toContain("server-side JavaScript operators");
                expect(content).toContain('Query on collection "people"');
                expectFindStructuredContent(response, content, {
                    documents: [expect.objectContaining({ name: "Laura", age: 10 })],
                });
            }
        });
    }

    it("rejects a projection using $function when disableServerSideJs is true", async () => {
        integration.mcpServer().userConfig.disableServerSideJs = true;
        const connectionId = await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: {
                connectionId,
                database: integration.randomDbName(),
                collection: "people",
                filter: {},
                projection: { computed: { $function: { body: "function() { return 1; }", args: [], lang: "js" } } },
            },
        });
        const content = getResponseContent(response);
        expect(content).toContain(`The "$function" operator is not allowed.`);
    });
});
