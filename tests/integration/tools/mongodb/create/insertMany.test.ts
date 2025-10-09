import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import { expect, it } from "vitest";

describeWithMongoDB("insertMany tool", (integration) => {
    validateToolMetadata(integration, "insert-many", "Insert an array of documents into a MongoDB collection", [
        ...databaseCollectionParameters,
        {
            name: "documents",
            type: "array",
            description:
                "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany()",
            required: true,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "insert-many", [
        {},
        { collection: "bar", database: 123, documents: [] },
        { collection: [], database: "test", documents: [] },
        { collection: "bar", database: "test", documents: "my-document" },
        { collection: "bar", database: "test", documents: { name: "Peter" } },
    ]);

    const validateDocuments = async (collection: string, expectedDocuments: object[]): Promise<void> => {
        const collections = await integration.mongoClient().db(integration.randomDbName()).listCollections().toArray();
        expectDefined(collections.find((c) => c.name === collection));

        const docs = await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection(collection)
            .find()
            .toArray();

        expect(docs).toHaveLength(expectedDocuments.length);
        for (const expectedDocument of expectedDocuments) {
            expect(docs).toContainEqual(expect.objectContaining(expectedDocument));
        }
    };

    it("creates the namespace if necessary", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1" }],
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain('Inserted `1` document(s) into collection "coll1"');

        await validateDocuments("coll1", [{ prop1: "value1" }]);
    });

    it("returns an error when inserting duplicates", async () => {
        const { insertedIds } = await integration
            .mongoClient()
            .db(integration.randomDbName())
            .collection("coll1")
            .insertMany([{ prop1: "value1" }]);

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1", _id: { $oid: insertedIds[0] } }],
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain("Error running insert-many");
        expect(content).toContain("duplicate key error");
        expect(content).toContain(insertedIds[0]?.toString());
    });

    validateAutoConnectBehavior(integration, "insert-many", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "coll1",
                documents: [{ prop1: "value1" }],
            },
            expectedResponse: 'Inserted `1` document(s) into collection "coll1"',
        };
    });
});
