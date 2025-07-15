import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
} from "../../../helpers.js";
import { describe, expect, it } from "vitest";

describeWithMongoDB("createCollection tool", (integration) => {
    validateToolMetadata(
        integration,
        "create-collection",
        "Creates a new collection in a database. If the database doesn't exist, it will be created automatically.",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "create-collection", databaseCollectionInvalidArgs);

    describe("with non-existent database", () => {
        it("creates a new collection", async () => {
            const mongoClient = integration.mongoClient();
            let collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(0);

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "create-collection",
                arguments: { database: integration.randomDbName(), collection: "bar" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(`Collection "bar" created in database "${integration.randomDbName()}".`);

            collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(1);
            expect(collections[0]?.name).toEqual("bar");
        });
    });

    describe("with existing database", () => {
        it("creates new collection", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).createCollection("collection1");
            let collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(1);

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "create-collection",
                arguments: { database: integration.randomDbName(), collection: "collection2" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(`Collection "collection2" created in database "${integration.randomDbName()}".`);
            collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(2);
            expect(collections.map((c) => c.name)).toIncludeSameMembers(["collection1", "collection2"]);
        });

        it("does nothing if collection already exists", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).collection("collection1").insertOne({});
            let collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(1);
            let documents = await mongoClient
                .db(integration.randomDbName())
                .collection("collection1")
                .find({})
                .toArray();
            expect(documents).toHaveLength(1);

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "create-collection",
                arguments: { database: integration.randomDbName(), collection: "collection1" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(`Collection "collection1" created in database "${integration.randomDbName()}".`);
            collections = await mongoClient.db(integration.randomDbName()).listCollections().toArray();
            expect(collections).toHaveLength(1);
            expect(collections[0]?.name).toEqual("collection1");

            // Make sure we didn't drop the existing collection
            documents = await mongoClient.db(integration.randomDbName()).collection("collection1").find({}).toArray();
            expect(documents).toHaveLength(1);
        });
    });

    validateAutoConnectBehavior(integration, "create-collection", () => {
        return {
            args: { database: integration.randomDbName(), collection: "new-collection" },
            expectedResponse: `Collection "new-collection" created in database "${integration.randomDbName()}".`,
        };
    });
});
