import {
    createVectorSearchIndexAndWait,
    describeWithMongoDB,
    validateAutoConnectBehavior,
    waitUntilSearchIsReady,
} from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
    getDataFromUntrustedContent,
} from "../../../helpers.js";
import { beforeEach, afterEach, expect, it } from "vitest";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import { ObjectId } from "bson";

describeWithMongoDB("insertMany tool when search is disabled", (integration) => {
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
        expect(content).toContain(`Inserted \`1\` document(s) into ${integration.randomDbName()}.coll1.`);

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
            expectedResponse: `Inserted \`1\` document(s) into ${integration.randomDbName()}.coll1.`,
        };
    });
});

describeWithMongoDB(
    "insertMany tool when search is enabled",
    (integration) => {
        let provider: NodeDriverServiceProvider;

        beforeEach(async ({ signal }) => {
            await integration.connectMcpClient();
            provider = integration.mcpServer().session.serviceProvider;
            await provider.createCollection(integration.randomDbName(), "test");
            await waitUntilSearchIsReady(provider, signal);
        });

        afterEach(async () => {
            await provider.dropCollection(integration.randomDbName(), "test");
        });

        it("inserts a document when the embedding is correct", async ({ signal }) => {
            await createVectorSearchIndexAndWait(
                provider,
                integration.randomDbName(),
                "test",
                [
                    {
                        type: "vector",
                        path: "embedding",
                        numDimensions: 8,
                        similarity: "euclidean",
                        quantization: "scalar",
                    },
                ],
                signal
            );

            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "test",
                    documents: [{ embedding: [1, 2, 3, 4, 5, 6, 7, 8] }],
                },
            });

            const content = getResponseContent(response.content);
            const insertedIds = extractInsertedIds(content);
            expect(insertedIds).toHaveLength(1);

            const docCount = await provider.countDocuments(integration.randomDbName(), "test", { _id: insertedIds[0] });
            expect(docCount).toBe(1);
        });

        it("returns an error when there is a search index and quantisation is wrong", async ({ signal }) => {
            await createVectorSearchIndexAndWait(
                provider,
                integration.randomDbName(),
                "test",
                [
                    {
                        type: "vector",
                        path: "embedding",
                        numDimensions: 8,
                        similarity: "euclidean",
                        quantization: "scalar",
                    },
                ],
                signal
            );

            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database: integration.randomDbName(),
                    collection: "test",
                    documents: [{ embedding: "oopsie" }],
                },
            });

            const content = getResponseContent(response.content);
            expect(content).toContain("There were errors when inserting documents. No document was inserted.");
            const untrustedContent = getDataFromUntrustedContent(content);
            expect(untrustedContent).toContain(
                "- Field embedding is an embedding with 8 dimensions and scalar quantization, and the provided value is not compatible."
            );

            const oopsieCount = await provider.countDocuments(integration.randomDbName(), "test", {
                embedding: "oopsie",
            });
            expect(oopsieCount).toBe(0);
        });
    },
    { downloadOptions: { search: true } }
);

function extractInsertedIds(content: string): ObjectId[] {
    expect(content).toContain("Documents were inserted successfully.");
    expect(content).toContain("Inserted IDs:");

    const match = content.match(/Inserted IDs:\s(.*)/);
    const group = match?.[1];
    return (
        group
            ?.split(",")
            .map((e) => e.trim())
            .map((e) => ObjectId.createFromHexString(e)) ?? []
    );
}
