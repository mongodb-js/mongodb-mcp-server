import { defaultTestConfig, getResponseContent } from "./helpers.js";
import { describeWithMongoDB } from "./tools/mongodb/mongodbHelpers.js";

describe("IndexCheck integration tests", () => {
    describe("with indexCheck enabled", () => {
        describeWithMongoDB(
            "indexCheck functionality",
            (integration) => {
                beforeEach(async () => {
                    await integration.connectMcpClient();
                });

                describe("find operations", () => {
                    beforeEach(async () => {
                        // Insert test data for find operations
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("find-test-collection")
                            .insertMany([
                                { name: "document1", value: 1, category: "A" },
                                { name: "document2", value: 2, category: "B" },
                                { name: "document3", value: 3, category: "A" },
                            ]);
                    });

                    it("should reject queries that perform collection scans", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "find",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "find-test-collection",
                                filter: { category: "A" }, // No index on category field
                            },
                        });

                        const content = getResponseContent(response.content);
                        expect(content).toContain("Index check failed");
                        expect(content).toContain("collection scan (COLLSCAN)");
                        expect(content).toContain("MDB_MCP_INDEX_CHECK");
                        expect(response.isError).toBe(true);
                    });

                    it("should allow queries that use indexes", async () => {
                        // Create an index on the category field
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("find-test-collection")
                            .createIndex({ category: 1 });

                        const response = await integration.mcpClient().callTool({
                            name: "find",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "find-test-collection",
                                filter: { category: "A" }, // Now has index
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Found");
                        expect(content).toContain("documents");
                    });

                    it("should allow queries using _id (IDHACK)", async () => {
                        const docs = await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("find-test-collection")
                            .find({})
                            .toArray();

                        expect(docs.length).toBeGreaterThan(0);

                        const response = await integration.mcpClient().callTool({
                            name: "find",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "find-test-collection",
                                filter: { _id: docs[0]?._id }, // Uses _id index (IDHACK)
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Found 1 documents");
                    });
                });

                describe("count operations", () => {
                    beforeEach(async () => {
                        // Insert test data for count operations
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("count-test-collection")
                            .insertMany([
                                { name: "document1", value: 1, category: "A" },
                                { name: "document2", value: 2, category: "B" },
                                { name: "document3", value: 3, category: "A" },
                            ]);
                    });

                    it("should reject count queries that perform collection scans", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "count",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "count-test-collection",
                                query: { value: { $gt: 1 } }, // No index on value field
                            },
                        });

                        const content = getResponseContent(response.content);
                        expect(content).toContain("Index check failed");
                        expect(content).toContain("count operation");
                        expect(response.isError).toBe(true);
                    });

                    it("should allow count queries with indexes", async () => {
                        // Create an index on the value field
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("count-test-collection")
                            .createIndex({ value: 1 });

                        const response = await integration.mcpClient().callTool({
                            name: "count",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "count-test-collection",
                                query: { value: { $gt: 1 } }, // Now has index
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Found");
                        expect(content).toMatch(/\d+ documents/);
                    });
                });

                describe("aggregate operations", () => {
                    beforeEach(async () => {
                        // Insert test data for aggregate operations
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("aggregate-test-collection")
                            .insertMany([
                                { name: "document1", value: 1, category: "A" },
                                { name: "document2", value: 2, category: "B" },
                                { name: "document3", value: 3, category: "A" },
                            ]);
                    });

                    it("should reject aggregation queries that perform collection scans", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "aggregate-test-collection",
                                pipeline: [
                                    { $match: { category: "A" } }, // No index on category
                                    { $group: { _id: "$category", count: { $sum: 1 } } },
                                ],
                            },
                        });

                        const content = getResponseContent(response.content);
                        expect(content).toContain("Index check failed");
                        expect(content).toContain("aggregate operation");
                        expect(response.isError).toBe(true);
                    });

                    it("should allow aggregation queries with indexes", async () => {
                        // Create an index on the category field
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("aggregate-test-collection")
                            .createIndex({ category: 1 });

                        const response = await integration.mcpClient().callTool({
                            name: "aggregate",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "aggregate-test-collection",
                                pipeline: [
                                    { $match: { category: "A" } }, // Now has index
                                ],
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Found");
                    });
                });

                describe("updateMany operations", () => {
                    beforeEach(async () => {
                        // Insert test data for updateMany operations
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("update-test-collection")
                            .insertMany([
                                { name: "document1", value: 1, category: "A" },
                                { name: "document2", value: 2, category: "B" },
                                { name: "document3", value: 3, category: "A" },
                            ]);
                    });

                    it("should reject updateMany queries that perform collection scans", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "update-many",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "update-test-collection",
                                filter: { category: "A" }, // No index on category
                                update: { $set: { updated: true } },
                            },
                        });

                        const content = getResponseContent(response.content);
                        expect(content).toContain("Index check failed");
                        expect(content).toContain("updateMany operation");
                        expect(response.isError).toBe(true);
                    });

                    it("should allow updateMany queries with indexes", async () => {
                        // Create an index on the category field
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("update-test-collection")
                            .createIndex({ category: 1 });

                        const response = await integration.mcpClient().callTool({
                            name: "update-many",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "update-test-collection",
                                filter: { category: "A" }, // Now has index
                                update: { $set: { updated: true } },
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Matched");
                        expect(content).toContain("Modified");
                    });
                });

                describe("deleteMany operations", () => {
                    beforeEach(async () => {
                        // Insert test data for deleteMany operations
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("delete-test-collection")
                            .insertMany([
                                { name: "document1", value: 1, category: "A" },
                                { name: "document2", value: 2, category: "B" },
                                { name: "document3", value: 3, category: "A" },
                            ]);
                    });

                    it("should reject deleteMany queries that perform collection scans", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "delete-many",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "delete-test-collection",
                                filter: { value: { $lt: 2 } }, // No index on value
                            },
                        });

                        const content = getResponseContent(response.content);
                        expect(content).toContain("Index check failed");
                        expect(content).toContain("deleteMany operation");
                        expect(response.isError).toBe(true);
                    });

                    it("should allow deleteMany queries with indexes", async () => {
                        // Create an index on the value field
                        await integration
                            .mongoClient()
                            .db(integration.randomDbName())
                            .collection("delete-test-collection")
                            .createIndex({ value: 1 });

                        const response = await integration.mcpClient().callTool({
                            name: "delete-many",
                            arguments: {
                                database: integration.randomDbName(),
                                collection: "delete-test-collection",
                                filter: { value: { $lt: 2 } }, // Now has index
                            },
                        });

                        expect(response.isError).toBeFalsy();
                        const content = getResponseContent(response.content);
                        expect(content).toContain("Deleted");
                        expect(content).toMatch(/`\d+` document\(s\)/);
                    });
                });
            },
            () => ({
                ...defaultTestConfig,
                indexCheck: true, // Enable indexCheck
            })
        );
    });

    describe("with indexCheck disabled", () => {
        describeWithMongoDB(
            "indexCheck disabled functionality",
            (integration) => {
                beforeEach(async () => {
                    await integration.connectMcpClient();

                    // insert test data for disabled indexCheck tests
                    await integration
                        .mongoClient()
                        .db(integration.randomDbName())
                        .collection("disabled-test-collection")
                        .insertMany([
                            { name: "document1", value: 1, category: "A" },
                            { name: "document2", value: 2, category: "B" },
                            { name: "document3", value: 3, category: "A" },
                        ]);
                });

                it("should allow all queries regardless of index usage", async () => {
                    // Test find operation without index
                    const findResponse = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "disabled-test-collection",
                            filter: { category: "A" }, // No index, but should be allowed
                        },
                    });

                    expect(findResponse.isError).toBeFalsy();
                    const findContent = getResponseContent(findResponse.content);
                    expect(findContent).toContain("Found");
                    expect(findContent).not.toContain("Index check failed");
                });

                it("should allow count operations without indexes", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "count",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "disabled-test-collection",
                            query: { value: { $gt: 1 } }, // No index, but should be allowed
                        },
                    });

                    expect(response.isError).toBeFalsy();
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Found");
                    expect(content).not.toContain("Index check failed");
                });

                it("should allow aggregate operations without indexes", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "aggregate",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "disabled-test-collection",
                            pipeline: [
                                { $match: { category: "A" } }, // No index, but should be allowed
                                { $group: { _id: "$category", count: { $sum: 1 } } },
                            ],
                        },
                    });

                    expect(response.isError).toBeFalsy();
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Found");
                    expect(content).not.toContain("Index check failed");
                });

                it("should allow updateMany operations without indexes", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "update-many",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "disabled-test-collection",
                            filter: { category: "A" }, // No index, but should be allowed
                            update: { $set: { updated: true } },
                        },
                    });

                    expect(response.isError).toBeFalsy();
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Matched");
                    expect(content).not.toContain("Index check failed");
                });

                it("should allow deleteMany operations without indexes", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "delete-many",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "disabled-test-collection",
                            filter: { value: { $lt: 2 } }, // No index, but should be allowed
                        },
                    });

                    expect(response.isError).toBeFalsy();
                    const content = getResponseContent(response.content);
                    expect(content).toContain("Deleted");
                    expect(content).not.toContain("Index check failed");
                });
            },
            () => ({
                ...defaultTestConfig,
                indexCheck: false, // Disable indexCheck
            })
        );
    });

    describe("indexCheck configuration validation", () => {
        describeWithMongoDB(
            "default indexCheck behavior",
            (integration) => {
                it("should allow collection scans by default when indexCheck is not specified", async () => {
                    await integration.connectMcpClient();

                    await integration
                        .mongoClient()
                        .db(integration.randomDbName())
                        .collection("default-test-collection")
                        .insertOne({ name: "test", value: 1 });

                    const response = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: {
                            database: integration.randomDbName(),
                            collection: "default-test-collection",
                            filter: { name: "test" }, // No index, should be allowed by default
                        },
                    });

                    expect(response.isError).toBeFalsy();
                });
            },
            () => ({
                ...defaultTestConfig,
                // indexCheck not specified, should default to false
            })
        );
    });
});
