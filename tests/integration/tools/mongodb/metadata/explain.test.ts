import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
    getResponseContent,
} from "../../../helpers.js";
import type { ExplainOutput } from "../../../../../src/tools/mongodb/metadata/explain.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describeWithMongoDB("explain tool", (integration) => {
    validateToolMetadata(
        integration,
        "explain",
        "Returns statistics describing the execution of the winning plan chosen by the query optimizer for the evaluated method",
        "metadata",
        [
            ...databaseCollectionParameters,

            {
                name: "method",
                description: "The method and its arguments to run",
                type: "array",
                required: true,
            },
            {
                name: "verbosity",
                description:
                    "The verbosity of the explain plan, defaults to queryPlanner. If the user wants to know how fast is a query in execution time, use executionStats. It supports all verbosities as defined in the MongoDB Driver.",
                type: "string",
                required: false,
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
                it(`should return the explain plan for "queryPlanner" verbosity for ${testCase.method}`, async () => {
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
                        `Here is some information about the winning plan chosen by the query optimizer for running the given \`${testCase.method}\` operation in "${integration.randomDbName()}.coll1". The execution plan was run with the following verbosity: "queryPlanner". This information can be used to understand how the query was executed and to optimize the query performance.`
                    );

                    expect(content[1]?.text).toContain("queryPlanner");
                    expect(content[1]?.text).toContain("winningPlan");
                    expect(content[1]?.text).not.toContain("executionStats");

                    // Validate structured content
                    const structuredContent = response.structuredContent as ExplainOutput;
                    expect(structuredContent.method).toBe(testCase.method);
                    expect(structuredContent.verbosity).toBe("queryPlanner");
                    expect(structuredContent.explainResult).toHaveProperty("queryPlanner");
                    expect(structuredContent.explainResult).toHaveProperty("command");
                });

                it(`should return the explain plan for "executionStats" verbosity for ${testCase.method}`, async () => {
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
                            verbosity: "executionStats",
                        },
                    });

                    const content = getResponseElements(response.content);
                    expect(content).toHaveLength(2);
                    expect(content[0]?.text).toEqual(
                        `Here is some information about the winning plan chosen by the query optimizer for running the given \`${testCase.method}\` operation in "${integration.randomDbName()}.coll1". The execution plan was run with the following verbosity: "executionStats". This information can be used to understand how the query was executed and to optimize the query performance.`
                    );

                    expect(content[1]?.text).toContain("queryPlanner");
                    expect(content[1]?.text).toContain("winningPlan");
                    expect(content[1]?.text).toContain("executionStats");

                    // Validate structured content
                    const structuredContent = response.structuredContent as ExplainOutput;
                    expect(structuredContent.method).toBe(testCase.method);
                    expect(structuredContent.verbosity).toBe("executionStats");
                    expect(structuredContent.explainResult).toHaveProperty("queryPlanner");
                    expect(structuredContent.explainResult).toHaveProperty("executionStats");
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
                    it(`should return the explain plan with verbosity "queryPlanner" for ${testCase.method}`, async () => {
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
                            `Here is some information about the winning plan chosen by the query optimizer for running the given \`${testCase.method}\` operation in "${integration.randomDbName()}.people". The execution plan was run with the following verbosity: "queryPlanner". This information can be used to understand how the query was executed and to optimize the query performance.`
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

                        // Validate structured content
                        const structuredContent = response.structuredContent as ExplainOutput;
                        expect(structuredContent.method).toBe(testCase.method);
                        expect(structuredContent.verbosity).toBe("queryPlanner");
                        expect(structuredContent.explainResult).toHaveProperty("queryPlanner");
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

describeWithMongoDB("explain tool with server-side JavaScript operators", (integration) => {
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

    const where = "function() { return this.age > 8; }";
    const jsMethods = [
        { method: "aggregate", arguments: { pipeline: [{ $match: { $where: where } }] } },
        { method: "find", arguments: { filter: { $where: where } } },
        { method: "count", arguments: { query: { $where: where } } },
    ];

    for (const { method, arguments: methodArguments } of jsMethods) {
        for (const jsDisabled of [true, false]) {
            it(`${jsDisabled ? "rejects" : "does not reject"} explaining ${method} using $where when disableServerSideJs is ${jsDisabled}`, async () => {
                integration.mcpServer().userConfig.disableServerSideJs = jsDisabled;
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "explain",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "people",
                        method: [{ name: method, arguments: methodArguments }],
                    },
                });
                const content = getResponseContent(response);
                if (jsDisabled) {
                    expect(content).toContain(`The "$where" operator is not allowed.`);
                } else {
                    // The guard must not be the one blocking $where once disableServerSideJs is false.
                    expect(content).not.toContain("server-side JavaScript operators");
                    expect(content).not.toContain("operator is not allowed");
                }
            });
        }
    }
});

describeWithMongoDB("explain tool with write stages", (integration) => {
    afterEach(() => {
        integration.mcpServer().userConfig.readOnly = false;
        integration.mcpServer().userConfig.disabledTools = [];
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

    // executionStats (and allPlansExecution) actually run the pipeline, so explaining an
    // aggregation with a $out/$merge stage could otherwise perform a write even in readOnly mode.
    for (const writeStage of ["$out", "$merge"] as const) {
        it(`rejects explaining aggregations with a ${writeStage} stage in readOnly mode`, async () => {
            integration.mcpServer().userConfig.readOnly = true;
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "explain",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    method: [{ name: "aggregate", arguments: { pipeline: [{ [writeStage]: "outpeople" }] } }],
                    verbosity: "executionStats",
                },
            });
            const content = getResponseContent(response);
            expect(content).toContain("In readOnly mode you can not run pipelines with $out or $merge stages.");
        });

        it(`rejects explaining aggregations with a ${writeStage} stage when write operations are disabled`, async () => {
            integration.mcpServer().userConfig.disabledTools = ["create"];
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "explain",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "people",
                    method: [{ name: "aggregate", arguments: { pipeline: [{ [writeStage]: "outpeople" }] } }],
                    verbosity: "executionStats",
                },
            });
            const content = getResponseContent(response);
            expect(content).toContain(
                "When 'create', 'update', or 'delete' operations are disabled, you can not run pipelines with $out or $merge stages."
            );
        });
    }
});
