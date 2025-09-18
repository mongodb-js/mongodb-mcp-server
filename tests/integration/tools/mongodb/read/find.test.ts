import { beforeEach, describe, expect, it } from "vitest";
import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import { describeWithMongoDB, getDocsFromUntrustedContent, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("find tool", (integration) => {
    validateToolMetadata(integration, "find", "Run a find query against a MongoDB collection", [
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
        expect(content).toEqual('Found 0 documents in the collection "foos".');
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
        expect(content).toEqual('Found 0 documents in the collection "non-existent".');
    });

    describe("with existing database", () => {
        beforeEach(async () => {
            const mongoClient = integration.mongoClient();
            const items = Array(10)
                .fill(0)
                .map((_, index) => ({
                    value: index,
                }));

            await mongoClient.db(integration.randomDbName()).collection("foo").insertMany(items);
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
                expect(content).toContain(`Found ${expected.length} documents in the collection "foo".`);

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
            expect(content).toContain('Found 10 documents in the collection "foo".');

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
            expect(content).toContain('Found 1 documents in the collection "foo".');

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
            expect(content).toContain('Found 1 documents in the collection "foo_with_dates".');

            const docs = getDocsFromUntrustedContent<{ date: Date }>(content);
            expect(docs.length).toEqual(1);

            expect(docs[0]?.date.toISOString()).toContain("2025-05-11");
        });
    });

    validateAutoConnectBehavior(integration, "find", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: 'Found 0 documents in the collection "coll1"',
        };
    });
});
