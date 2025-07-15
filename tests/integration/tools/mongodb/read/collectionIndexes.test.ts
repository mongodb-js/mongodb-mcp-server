import { IndexDirection } from "mongodb";
import {
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    getResponseElements,
    databaseCollectionInvalidArgs,
    expectDefined,
} from "../../../helpers.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { expect, it } from "vitest";

describeWithMongoDB("collectionIndexes tool", (integration) => {
    validateToolMetadata(
        integration,
        "collection-indexes",
        "Describe the indexes for a collection",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "collection-indexes", databaseCollectionInvalidArgs);

    it("can inspect indexes on non-existent database", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: { database: "non-existent", collection: "people" },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(1);
        expect(elements[0]?.text).toEqual(
            'The indexes for "non-existent.people" cannot be determined because the collection does not exist.'
        );
    });

    it("returns the _id index for a new collection", async () => {
        await integration.mongoClient().db(integration.randomDbName()).createCollection("people");

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
            },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(2);
        expect(elements[0]?.text).toEqual('Found 1 indexes in the collection "people":');
        expect(elements[1]?.text).toEqual('Name "_id_", definition: {"_id":1}');
    });

    it("returns all indexes for a collection", async () => {
        await integration.mongoClient().db(integration.randomDbName()).createCollection("people");

        const indexTypes: IndexDirection[] = [-1, 1, "2d", "2dsphere", "text", "hashed"];
        for (const indexType of indexTypes) {
            await integration
                .mongoClient()
                .db(integration.randomDbName())
                .collection("people")
                .createIndex({ [`prop_${indexType}`]: indexType });
        }

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "collection-indexes",
            arguments: {
                database: integration.randomDbName(),
                collection: "people",
            },
        });

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(indexTypes.length + 2);
        expect(elements[0]?.text).toEqual(`Found ${indexTypes.length + 1} indexes in the collection "people":`);
        expect(elements[1]?.text).toEqual('Name "_id_", definition: {"_id":1}');

        for (const indexType of indexTypes) {
            const index = elements.find((element) => element.text.includes(`prop_${indexType}`));
            expectDefined(index);

            let expectedDefinition = JSON.stringify({ [`prop_${indexType}`]: indexType });
            if (indexType === "text") {
                expectedDefinition = '{"_fts":"text"';
            }

            expect(index.text).toContain(`definition: ${expectedDefinition}`);
        }
    });

    validateAutoConnectBehavior(integration, "collection-indexes", () => {
        return {
            args: { database: integration.randomDbName(), collection: "coll1" },
            expectedResponse: `The indexes for "${integration.randomDbName()}.coll1" cannot be determined because the collection does not exist.`,
        };
    });
});
