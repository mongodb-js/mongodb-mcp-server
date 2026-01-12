import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseElements,
    getResponseContent,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseInvalidArgs,
    databaseParameters,
    getDataFromUntrustedContent,
} from "../../../helpers.js";
import { describe, expect, it } from "vitest";
import type { ListCollectionsOutput } from "../../../../../src/tools/mongodb/metadata/listCollections.js";

describeWithMongoDB("listCollections tool", (integration) => {
    validateToolMetadata(
        integration,
        "list-collections",
        "List all collections for a given database",
        "metadata",
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
                'Found 0 collections for database "non-existent". To create a collection, use the "create-collection" tool.'
            );

            // Structured content should have empty array for empty database
            const structuredContent = response.structuredContent as ListCollectionsOutput;
            expect(structuredContent.collections).toEqual([]);
            expect(structuredContent.totalCount).toBe(0);
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
            expect(items).toHaveLength(2);
            expect(items[0]?.text).toEqual(`Found 1 collections for database "${integration.randomDbName()}".`);

            const contentData = JSON.parse(
                getDataFromUntrustedContent(items[1]?.text ?? "")
            ) as ListCollectionsOutput["collections"];
            expect(contentData).toEqual([{ name: "collection-1" }]);

            const structuredContent = response.structuredContent as ListCollectionsOutput;
            expect(structuredContent.collections.map((c) => c.name)).toEqual(["collection-1"]);
            expect(structuredContent.totalCount).toBe(1);

            await mongoClient.db(integration.randomDbName()).createCollection("collection-2");

            const response2 = await integration.mcpClient().callTool({
                name: "list-collections",
                arguments: { database: integration.randomDbName() },
            });
            const items2 = getResponseElements(response2.content);
            expect(items2).toHaveLength(2);

            expect(items2[0]?.text).toEqual(`Found 2 collections for database "${integration.randomDbName()}".`);

            const contentData2 = JSON.parse(
                getDataFromUntrustedContent(items2[1]?.text ?? "")
            ) as ListCollectionsOutput["collections"];
            expect(contentData2.map((c: { name: string }) => c.name)).toIncludeSameMembers([
                "collection-1",
                "collection-2",
            ]);

            const structuredContent2 = response2.structuredContent as ListCollectionsOutput;
            expect(structuredContent2.collections.map((c) => c.name)).toIncludeSameMembers([
                "collection-1",
                "collection-2",
            ]);
            expect(structuredContent2.totalCount).toBe(2);
        });
    });

    validateAutoConnectBehavior(
        integration,
        "list-collections",

        () => {
            return {
                args: { database: integration.randomDbName() },
                expectedResponse: `Found 0 collections for database "${integration.randomDbName()}". To create a collection, use the "create-collection" tool.`,
            };
        }
    );
});
