import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { describeWithMongoDB, getDocsFromUntrustedContent, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import type { Client } from "@modelcontextprotocol/sdk/client";

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
            description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded. Note to LLM: If the entire query result is required, use the "export" tool instead of increasing this limit.`,
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
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: { database: "non-existent", collection: "foos" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Query on collection "foos" resulted in 0 documents. Returning 0 documents.');
    });

    it("returns 0 when collection doesn't exist", async () => {
        await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        await mongoClient.db(integration.randomDbName()).collection("bar").insertOne({});
        const response = await integration.mcpClient().callTool({
            name: "find",
            arguments: { database: integration.randomDbName(), collection: "non-existent" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Query on collection "non-existent" resulted in 0 documents. Returning 0 documents.');
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
        }[] = [
            {
                name: "returns all documents when no filter is provided",
                expected: Array(10)
                    .fill(0)
                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index })),
            },
            {
                name: "returns documents matching the filter",
                filter: { value: { $gt: 5 } },
                expected: Array(4)
                    .fill(0)

                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index + 6 })),
            },
            {
                name: "returns documents matching the filter with projection",
                filter: { value: { $gt: 5 } },
                projection: { value: 1, _id: 0 },
                expected: Array(4)
                    .fill(0)
                    .map((_, index) => ({ value: index + 6 })),
            },
            {
                name: "returns documents matching the filter with limit",
                filter: { value: { $gt: 5 } },
                limit: 2,
                expected: [
                    { _id: expect.any(Object) as unknown, value: 6 },
                    { _id: expect.any(Object) as unknown, value: 7 },
                ],
            },
            {
                name: "returns documents matching the filter with sort",
                filter: {},
                sort: { value: -1 },
                expected: Array(10)
                    .fill(0)
                    .map((_, index) => ({ _id: expect.any(Object) as unknown, value: index }))
                    .reverse(),
            },
        ];

        for (const { name, filter, limit, projection, sort, expected } of testCases) {
            it(name, async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "find",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        filter,
                        limit,
                        projection,
                        sort,
                    },
                });
                const content = getResponseContent(response);
                expect(content).toContain(`Query on collection "foo" resulted in ${expected.length} documents.`);

                const docs = getDocsFromUntrustedContent(content);

                for (let i = 0; i < expected.length; i++) {
                    expect(docs[i]).toEqual(expected[i]);
                }
            });
        }

        it("returns all documents when no filter is provided", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });
            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo" resulted in 10 documents.');

            const docs = getDocsFromUntrustedContent(content);
            expect(docs.length).toEqual(10);

            for (let i = 0; i < 10; i++) {
                expect((docs[i] as { value: number }).value).toEqual(i);
            }
        });

        it("can find objects by $oid", async () => {
            await integration.connectMcpClient();

            const fooObject = await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("foo")
                .findOne();
            expectDefined(fooObject);

            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: { _id: { $oid: fooObject._id } },
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo" resulted in 1 documents.');

            const docs = getDocsFromUntrustedContent(content);
            expect(docs.length).toEqual(1);

            expect((docs[0] as { value: number }).value).toEqual(fooObject.value);
        });

        it("can find objects by date", async () => {
            await integration.connectMcpClient();

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
                    database: integration.randomDbName(),
                    collection: "foo_with_dates",
                    filter: { date: { $gt: { $date: "2025-05-10" } } }, // only 2025-05-11 will match
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(
                'Query on collection "foo_with_dates" resulted in 1 documents. Returning 1 documents.'
            );

            const docs = getDocsFromUntrustedContent<{ date: Date }>(content);
            expect(docs.length).toEqual(1);

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
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });
            const content = getResponseContent(response);
            expect(content).toContain('Query on collection "foo" resulted in indeterminable number of documents.');

            const docs = getDocsFromUntrustedContent(content);
            expect(docs.length).toEqual(10);
        });
    });
});

describeWithMongoDB(
    "find tool with configured max documents per query",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 1000,
            });
        });

        afterEach(() => {
            vi.resetAllMocks();
        });

        it("should return documents limited to the provided limit when provided limit < configured limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 8,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 8 documents.`);
            expect(content).toContain(`Returning 8 documents.`);
        });

        it("should return documents limited to the configured max limit when provided limit > configured limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 10000,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 1000 documents.`);
            expect(content).toContain(
                `Returning 10 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery.`
            );
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: 10 }),
    }
);

describeWithMongoDB(
    "find tool with configured max bytes per query",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 1000,
            });
        });
        it("should return only the documents that could fit in configured maxBytesPerQuery limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 1000,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 1000 documents.`);
            expect(content).toContain(
                `Returning 3 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, server's configured - maxBytesPerQuery`
            );
        });
        it("should return only the documents that could fit in provided responseBytesLimit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 1000,
                    responseBytesLimit: 50,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 1000 documents.`);
            expect(content).toContain(
                `Returning 1 documents while respecting the applied limits of server's configured - maxDocumentsPerQuery, tool's parameter - responseBytesLimit.`
            );
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxBytesPerQuery: 100 }),
    }
);

describeWithMongoDB(
    "find tool with disabled max limit and max bytes per query",
    (integration) => {
        beforeEach(async () => {
            await freshInsertDocuments({
                collection: integration.mongoClient().db(integration.randomDbName()).collection("foo"),
                count: 1000,
            });
        });

        it("should return documents limited to the provided limit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 8,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 8 documents.`);
            expect(content).toContain(`Returning 8 documents.`);
        });

        it("should return documents limited to the responseBytesLimit", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "foo",
                    filter: {},
                    limit: 1000,
                    responseBytesLimit: 50,
                },
            });

            const content = getResponseContent(response);
            expect(content).toContain(`Query on collection "foo" resulted in 1000 documents.`);
            expect(content).toContain(
                `Returning 1 documents while respecting the applied limits of tool's parameter - responseBytesLimit.`
            );
        });
    },
    {
        getUserConfig: () => ({ ...defaultTestConfig, maxDocumentsPerQuery: -1, maxBytesPerQuery: -1 }),
    }
);

describeWithMongoDB("find tool with abort signal", (integration) => {
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
        await integration.connectMcpClient();
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
        await integration.connectMcpClient();
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
        await integration.connectMcpClient();

        const { result, error, executionTime } = await runSlowFind();

        // 10 docs, each doc processing sleeps 100ms, so total should be around 1s
        expect(executionTime).toBeGreaterThan(1000);
        expectDefined(result);
        expect(error).toBeUndefined();
        const content = getResponseContent(result);
        expect(content).toContain('Query on collection "abort_collection"');
    });
});
