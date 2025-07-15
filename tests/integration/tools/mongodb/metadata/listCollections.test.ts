import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseElements,
    getResponseContent,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseInvalidArgs,
    databaseParameters,
} from "../../../helpers.js";
import { describe, expect, it } from "vitest";

describeWithMongoDB("listCollections tool", (integration) => {
    validateToolMetadata(
        integration,
        "list-collections",
        "List all collections for a given database",
        databaseParameters
    );

    validateThrowsForInvalidArguments(integration, "list-collections", databaseInvalidArgs);

    describe("with non-existent database", () => {
        it("returns no collections", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "list-collections",
                arguments: { database: "non-existent" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                'No collections found for database "non-existent". To create a collection, use the "create-collection" tool.'
            );
        });
    });

    describe("with existing database", () => {
        it("returns collections", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).createCollection("collection-1");

            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "list-collections",
                arguments: { database: integration.randomDbName() },
            });
            const items = getResponseElements(response.content);
            expect(items).toHaveLength(1);
            expect(items[0]?.text).toContain('Name: "collection-1"');

            await mongoClient.db(integration.randomDbName()).createCollection("collection-2");

            const response2 = await integration.mcpClient().callTool({
                name: "list-collections",
                arguments: { database: integration.randomDbName() },
            });
            const items2 = getResponseElements(response2.content);
            expect(items2).toHaveLength(2);
            expect(items2.map((item) => item.text)).toIncludeSameMembers([
                'Name: "collection-1"',
                'Name: "collection-2"',
            ]);
        });
    });

    validateAutoConnectBehavior(
        integration,
        "list-collections",

        () => {
            return {
                args: { database: integration.randomDbName() },
                expectedResponse: `No collections found for database "${integration.randomDbName()}". To create a collection, use the "create-collection" tool.`,
            };
        }
    );
});
