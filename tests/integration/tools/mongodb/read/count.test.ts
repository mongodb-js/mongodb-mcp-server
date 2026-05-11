import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client";
import { freshInsertDocuments } from "./find.test.js";

describeWithMongoDB("count tool", (integration) => {
    validateToolMetadata(
        integration,
        "count",
        "Gets the number of documents in a MongoDB collection using db.collection.count() and query as an optional filter parameter",
        "read",
        [
            {
                name: "query",
                description:
                    "A filter/query parameter. Allows users to filter the documents to count. Matches the syntax of the filter argument of db.collection.count().",
                type: "object",
                required: false,
            },
            ...databaseCollectionParameters,
        ]
    );

    validateThrowsForInvalidArguments(integration, "count", [
        {},
        { database: 123, collection: "bar" },
        { collection: [], database: "test" },
        { collection: "bar", database: "test", query: "{ $gt: { foo: 5 } }" },
    ]);

    it("returns 0 when database doesn't exist", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "count",
            arguments: { database: "non-existent", collection: "foos" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Found 0 documents in the collection "foos".');
    });

    it("returns 0 when collection doesn't exist", async () => {
        await integration.connectMcpClient();
        const mongoClient = integration.mongoClient();
        await mongoClient.db(integration.randomDbName()).collection("bar").insertOne({});
        const response = await integration.mcpClient().callTool({
            name: "count",
            arguments: { database: integration.randomDbName(), collection: "non-existent" },
        });
        const content = getResponseContent(response.content);
        expect(content).toEqual('Found 0 documents in the collection "non-existent".');
    });

    describe("with existing database", () => {
        beforeEach(async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient
                .db(integration.randomDbName())
                .collection("foo")
                .insertMany([
                    { name: "Peter", age: 5 },
                    { name: "Parker", age: 10 },
                    { name: "George", age: 15 },
                ]);
        });

        const testCases = [
            { filter: undefined, expectedCount: 3 },
            { filter: {}, expectedCount: 3 },
            { filter: { age: { $lt: 15 } }, expectedCount: 2 },
            { filter: { age: { $gt: 5 }, name: { $regex: "^P" } }, expectedCount: 1 },
        ];
        for (const testCase of testCases) {
            it(`returns ${testCase.expectedCount} documents for filter ${JSON.stringify(testCase.filter)}`, async () => {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "count",
                    arguments: { database: integration.randomDbName(), collection: "foo", query: testCase.filter },
                });

                const content = getResponseContent(response.content);
                expect(content).toEqual(
                    `Found ${testCase.expectedCount} documents in the collection "foo"${testCase.filter ? " that matched the query" : ""}.`
                );
            });
        }
    });

    validateAutoConnectBehavior(integration, "count", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: 'Found 0 documents in the collection "coll1".',
        };
    });
});

describeWithMongoDB("count tool with abort signal", (integration) => {
    beforeEach(async () => {
        // Insert many documents with complex data to simulate a slow query
        await freshInsertDocuments({
            collection: integration.mongoClient().db(integration.randomDbName()).collection("abort_collection"),
            count: 10000,
            documentMapper: (index) => ({
                _id: index,
                description: `Document ${index}`,
                problemString: "a".repeat(100000) + "c",
            }),
        });
    });

    const runSlowCount = async (
        signal?: AbortSignal
    ): Promise<{ executionTime: number; result?: Awaited<ReturnType<Client["callTool"]>>; error?: Error }> => {
        const startTime = performance.now();

        let result: Awaited<ReturnType<Client["callTool"]>> | undefined;
        let error: Error | undefined;
        try {
            result = await integration.mcpClient().callTool(
                {
                    name: "count",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "abort_collection",
                        query: {
                            problemString: {
                                $regex: "(a+a+)+b", // This regex is catastrophic for backtracking
                                $options: "i",
                            },
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

    it("should abort count operation when signal is triggered immediately", async () => {
        await integration.connectMcpClient();
        const abortController = new AbortController();

        const countPromise = runSlowCount(abortController.signal);

        // Abort immediately
        abortController.abort();

        const { result, error, executionTime } = await countPromise;

        expect(executionTime).toBeLessThan(15); // Ensure it aborted quickly
        expect(result).toBeUndefined();
        expectDefined(error);
        expect(error.message).toContain("This operation was aborted");
    });

    it("should abort count operation during query execution", async () => {
        await integration.connectMcpClient();
        const abortController = new AbortController();

        // Start a count with $where that requires scanning many documents
        const countPromise = runSlowCount(abortController.signal);

        // Give the query a bit of time to start processing, then abort
        setTimeout(() => abortController.abort(), 15);

        const { result, error, executionTime } = await countPromise;

        // Ensure it aborted quickly, but possibly after some processing
        expect(executionTime).toBeGreaterThanOrEqual(15);
        expect(executionTime).toBeLessThan(30);
        expect(result).toBeUndefined();
        expectDefined(error);
        expect(error.message).toContain("This operation was aborted");
    });

    it("should complete successfully when not aborted", async () => {
        await integration.connectMcpClient();

        const { result, error, executionTime } = await runSlowCount();

        expect(executionTime).toBeGreaterThan(50);
        expectDefined(result);
        expect(error).toBeUndefined();
        const content = getResponseContent(result);
        expect(content).toContain('Found 0 documents in the collection "abort_collection" that matched the query.');
    });
});
