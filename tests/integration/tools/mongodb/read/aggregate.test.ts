import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
} from "../../../helpers.js";
import { expect, it } from "vitest";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

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

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(1);
        expect(elements[0]?.text).toEqual('Found 0 documents in the collection "people":');
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

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(1);
        expect(elements[0]?.text).toEqual('Found 0 documents in the collection "people":');
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

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(3);
        expect(elements[0]?.text).toEqual('Found 2 documents in the collection "people":');
        expect(asObject(JSON.parse(elements[1]?.text ?? "{}"))).toEqual(
            expect.objectContaining({
                _id: expect.any(Object) as object,
                name: "Søren",
                age: 15,
            })
        );
        expect(asObject(JSON.parse(elements[2]?.text ?? "{}"))).toEqual(
            expect.objectContaining({
                _id: expect.any(Object) as object,
                name: "Laura",
                age: 10,
            })
        );
    });

    validateAutoConnectBehavior(integration, "aggregate", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                pipeline: [{ $match: { name: "Liva" } }],
            },
            expectedResponse: 'Found 0 documents in the collection "coll1"',
        };
    });
});

function asObject(val: unknown): Record<string, unknown> {
    if (typeof val === "object" && val !== null) return val as Record<string, unknown>;
    throw new Error("Expected an object");
}
