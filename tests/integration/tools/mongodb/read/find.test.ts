import { beforeEach, describe, expect, it } from "vitest";
import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
    expectDefined,
} from "../../../helpers.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

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
        expect(content).toEqual('Found 0 documents in the collection "foos":');
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
        expect(content).toEqual('Found 0 documents in the collection "non-existent":');
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
                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(expected.length + 1);
                expect(elements[0]?.text).toEqual(`Found ${expected.length} documents in the collection "foo":`);

                for (let i = 0; i < expected.length; i++) {
                    expect(JSON.parse(elements[i + 1]?.text ?? "{}")).toEqual(expected[i]);
                }
            });
        }

        it("returns all documents when no filter is provided", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "find",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });
            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(11);
            expect(elements[0]?.text).toEqual('Found 10 documents in the collection "foo":');

            for (let i = 0; i < 10; i++) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                expect(JSON.parse(elements[i + 1]?.text ?? "{}").value).toEqual(i);
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
                    filter: { _id: fooObject._id },
                },
            });

            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toEqual('Found 1 documents in the collection "foo":');

            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            expect(JSON.parse(elements[1]?.text ?? "{}").value).toEqual(fooObject.value);
        });
    });

    validateAutoConnectBehavior(integration, "find", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: 'Found 0 documents in the collection "coll1":',
        };
    });
});
