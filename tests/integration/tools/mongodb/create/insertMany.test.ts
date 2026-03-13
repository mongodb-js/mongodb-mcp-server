import {
    describeWithMongoDB,
    validateAutoConnectBehavior,
    createVectorSearchIndexAndWait,
    waitUntilSearchIsReady,
    waitUntilSearchIndexIsListed,
} from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
    getDataFromUntrustedContent,
    defaultTestConfig,
} from "../../../helpers.js";
import type { InsertManyOutput } from "../../../../../src/tools/mongodb/create/insertMany.js";
import { beforeEach, afterEach, expect, it, describe, vi } from "vitest";
import { ObjectId } from "bson";
import type { Collection } from "mongodb";
import type { ToolEvent } from "../../../../../src/telemetry/types.js";

describeWithMongoDB("insertMany tool when search is disabled", (integration) => {
    validateToolMetadata(
        integration,
        "insert-many",
        "Insert an array of documents into a MongoDB collection. If the list of documents is above com.mongodb/maxRequestPayloadBytes, consider inserting them in batches.",
        "create",
        [
            ...databaseCollectionParameters,
            {
                name: "documents",
                type: "array",
                description:
                    "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany().",
                required: true,
            },
        ]
    );

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

        // Validate structured content
        const structuredContent = response.structuredContent as InsertManyOutput;
        expect(structuredContent.database).toBe(integration.randomDbName());
        expect(structuredContent.collection).toBe("coll1");
        expect(structuredContent.insertedCount).toBe(1);
        expect(structuredContent.insertedIds).toHaveLength(1);

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

    it("should emit tool event without auto-embedding usage metadata", async () => {
        const mockEmitEvents = vi.spyOn(integration.mcpServer()["telemetry"], "emitEvents");
        vi.spyOn(integration.mcpServer()["telemetry"], "isTelemetryEnabled").mockReturnValue(true);
        await integration.connectMcpClient();

        const response = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: integration.randomDbName(),
                collection: "test",
                documents: [{ title: "The Matrix" }],
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain("Documents were inserted successfully.");

        expect(mockEmitEvents).toHaveBeenCalled();
        const emittedEvent = mockEmitEvents.mock.lastCall?.[0][0] as ToolEvent;
        expectDefined(emittedEvent);
        expect(emittedEvent.properties.embeddingsGeneratedBy).toBeUndefined();
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
        let collection: Collection;
        let database: string;

        beforeEach(async () => {
            await integration.connectMcpClient();
            database = integration.randomDbName();
            collection = await integration.mongoClient().db(database).createCollection("test");
            await waitUntilSearchIsReady(integration.mongoClient());
        });

        afterEach(async () => {
            await collection.drop();
        });

        validateToolMetadata(
            integration,
            "insert-many",
            "Insert an array of documents into a MongoDB collection. If the list of documents is above com.mongodb/maxRequestPayloadBytes, consider inserting them in batches.",
            "create",
            [
                ...databaseCollectionParameters,
                {
                    name: "documents",
                    type: "array",
                    description:
                        "The array of documents to insert, matching the syntax of the document argument of db.collection.insertMany().",
                    required: true,
                },
            ]
        );

        it("inserts a document when the embedding is correct", async () => {
            await createVectorSearchIndexAndWait(integration.mongoClient(), database, "test", [
                {
                    type: "vector",
                    path: "embedding",
                    numDimensions: 8,
                    similarity: "euclidean",
                    quantization: "scalar",
                },
            ]);

            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database,
                    collection: "test",
                    documents: [{ embedding: [1, 2, 3, 4, 5, 6, 7, 8] }],
                },
            });

            const content = getResponseContent(response.content);
            const insertedIds = extractInsertedIds(content);
            expect(insertedIds).toHaveLength(1);

            // Validate structured content
            const structuredContent = response.structuredContent as InsertManyOutput;
            expect(structuredContent.database).toBe(database);
            expect(structuredContent.collection).toBe("test");
            expect(structuredContent.insertedCount).toBe(1);
            expect(structuredContent.insertedIds).toHaveLength(1);
            expect(structuredContent.insertedIds[0]).toEqual(insertedIds[0]);

            const docCount = await collection.countDocuments({ _id: insertedIds[0] });
            expect(docCount).toBe(1);
        });

    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            // This is expected to be set through the CI env. When not set we
            // get a warning in the run logs.
            voyageApiKey: process.env.MDB_VOYAGE_API_KEY ?? "",
            previewFeatures: ["search"],
        }),
        downloadOptions: { search: true },
    }
);

describeWithMongoDB(
    "insertMany tool with auto-embed index",
    (integration) => {
        let collection: Collection;
        let database: string;

        beforeEach(async () => {
            await integration.connectMcpClient();
            database = integration.randomDbName();

            collection = await integration.mongoClient().db(database).createCollection("test");
            await waitUntilSearchIsReady(integration.mongoClient());
            await collection.createSearchIndexes([
                {
                    type: "vectorSearch",
                    name: "my-auto-embed-index",
                    definition: {
                        fields: [{ type: "autoEmbed", path: "plot", model: "voyage-4-large", modality: "text" }],
                    },
                },
            ]);
        });

        it("should be able to insert document and have embeddings auto-generated", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "insert-many",
                arguments: {
                    database,
                    collection: "test",
                    documents: [{ plot: "A movie about alien" }, { plot: "Random movie about cupcake" }],
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain(`Inserted \`2\` document(s) into ${integration.randomDbName()}.test.`);
        });

    },
    {
        getUserConfig: () => ({
            ...defaultTestConfig,
            // This is expected to be set through the CI env. When not set we
            // get a warning in the run logs.
            voyageApiKey: process.env.MDB_VOYAGE_API_KEY ?? "",
            previewFeatures: ["search"],
        }),
        downloadOptions: {
            autoEmbed: true,
            mongotPassword: process.env.MDB_MONGOT_PASSWORD as string,
            voyageIndexingKey: process.env.MDB_VOYAGE_API_KEY as string,
            voyageQueryKey: process.env.MDB_VOYAGE_API_KEY as string,
        },
    }
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
