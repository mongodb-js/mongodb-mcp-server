import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
} from "../../../helpers.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("explain tool", (integration) => {
    validateToolMetadata(
        integration,
        "explain",
        "Returns statistics describing the execution of the winning plan chosen by the query optimizer for the evaluated method",
        [
            ...databaseCollectionParameters,

            {
                name: "method",
                description: "The method and its arguments to run",
                type: "array",
                required: true,
            },
        ]
    );

    validateThrowsForInvalidArguments(integration, "explain", [
        {},
        { database: 123, collection: "bar", method: [{ name: "find", arguments: {} }] },
        { database: "test", collection: true, method: [{ name: "find", arguments: {} }] },
        { database: "test", collection: "bar", method: [{ name: "dnif", arguments: {} }] },
        { database: "test", collection: "bar", method: "find" },
        { database: "test", collection: "bar", method: { name: "find", arguments: {} } },
    ]);

    const testCases = [
        {
            method: "aggregate",
            arguments: { pipeline: [{ $match: { name: "Peter" } }] },
        },
        {
            method: "find",
            arguments: { filter: { name: "Peter" } },
        },
        {
            method: "count",
            arguments: {
                query: { name: "Peter" },
            },
        },
    ];

    for (const testType of ["database", "collection"] as const) {
        describe(`with non-existing ${testType}`, () => {
            for (const testCase of testCases) {
                it(`should return the explain plan for ${testCase.method}`, async () => {
                    if (testType === "database") {
                        const { databases } = await integration.mongoClient().db("").admin().listDatabases();
                        expect(databases.find((db) => db.name === integration.randomDbName())).toBeUndefined();
                    } else if (testType === "collection") {
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .createCollection("some-collection");

                        const collections = await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .listCollections()
                            .toArray();

                        expect(collections.find((collection) => collection.name === "coll1")).toBeUndefined();
                    }

                    await integration.connectMcpClient();

                    const response = await integration.mcpClient().callTool({
                        name: "explain",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "coll1",
                            method: [
                                {
                                    name: testCase.method,
                                    arguments: testCase.arguments,
                                },
                            ],
                        },
                    });

                    const content = getResponseElements(response.content);
                    expect(content).toHaveLength(2);
                    expect(content[0]?.text).toEqual(
                        `Here is some information about the winning plan chosen by the query optimizer for running the given \`${testCase.method}\` operation in "${integration.randomDbName()}.coll1". This information can be used to understand how the query was executed and to optimize the query performance.`
                    );

                    expect(content[1]?.text).toContain("queryPlanner");
                    expect(content[1]?.text).toContain("winningPlan");
                });
            }
        });
    }

    describe("with existing database and collection", () => {
        for (const indexed of [true, false] as const) {
            describe(`with ${indexed ? "an index" : "no index"}`, () => {
                beforeEach(async () => {
                    await integration
                        .mongoClient()
                        .db(integration.randomDbName())
                        .collection("people")
                        .insertMany([{ name: "Alice" }, { name: "Bob" }, { name: "Charlie" }]);

                    if (indexed) {
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("people")
                            .createIndex({ name: 1 });
                    }
                });

                for (const testCase of testCases) {
                    it(`should return the explain plan for ${testCase.method}`, async () => {
                        await integration.connectMcpClient();

                        const response = await integration.mcpClient().callTool({
                            name: "explain",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "people",
                                method: [
                                    {
                                        name: testCase.method,
                                        arguments: testCase.arguments,
                                    },
                                ],
                            },
                        });

                        const content = getResponseElements(response.content);
                        expect(content).toHaveLength(2);
                        expect(content[0]?.text).toEqual(
                            `Here is some information about the winning plan chosen by the query optimizer for running the given \`${testCase.method}\` operation in "${integration.randomDbName()}.people". This information can be used to understand how the query was executed and to optimize the query performance.`
                        );

                        expect(content[1]?.text).toContain("queryPlanner");
                        expect(content[1]?.text).toContain("winningPlan");

                        if (indexed) {
                            if (testCase.method === "count") {
                                expect(content[1]?.text).toContain("COUNT_SCAN");
                            } else {
                                expect(content[1]?.text).toContain("IXSCAN");
                            }
                            expect(content[1]?.text).toContain("name_1");
                        } else {
                            expect(content[1]?.text).toContain("COLLSCAN");
                        }
                    });
                }
            });
        }
    });

    validateAutoConnectBehavior(integration, "explain", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1", method: [] },
            expectedResponse: "No method provided. Expected one of the following: `aggregate`, `find`, or `count`",
        };
    });
});
