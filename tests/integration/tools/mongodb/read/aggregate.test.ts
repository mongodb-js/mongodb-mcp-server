import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseContent,
} from "../../../helpers.js";
import { expect, it } from "vitest";
import { describeWithMongoDB, getDocsFromUntrustedContent, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("aggregate tool", (integration) => {
    validateToolMetadata(integration, "aggregate", "Run an aggregation against a MongoDB collection", [
        ...databaseCollectionParameters,
        {
            name: "pipeline",
            description: "An array of aggregation stages to execute",
            type: "array",
            required: true,
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

    it("can run aggragation on non-existent database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "aggregate",
            arguments: { database: "non-existent", collection: "people", pipeline: [{ $match: { name: "Peter" } }] },
        });

        const content = getResponseContent(response);
        expect(content).toEqual("The aggregation resulted in 0 documents.");
    });

    it("can run aggragation on an empty collection", async () => {
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
        expect(content).toEqual("The aggregation resulted in 0 documents.");
    });

    it("can run aggragation on an existing collection", async () => {
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
});
