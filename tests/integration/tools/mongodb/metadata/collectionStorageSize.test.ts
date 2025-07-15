import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseContent,
    databaseCollectionParameters,
    databaseCollectionInvalidArgs,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    expectDefined,
} from "../../../helpers.js";
import * as crypto from "crypto";
import { describe, expect, it } from "vitest";

describeWithMongoDB("collectionStorageSize tool", (integration) => {
    validateToolMetadata(
        integration,
        "collection-storage-size",
        "Gets the size of the collection",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "collection-storage-size", databaseCollectionInvalidArgs);

    describe("with non-existent database", () => {
        it("returns an error", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-storage-size",
                arguments: { database: integration.randomDbName(), collection: "foo" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `The size of "${integration.randomDbName()}.foo" cannot be determined because the collection does not exist.`
            );
        });
    });

    describe("with existing database", () => {
        const testCases = [
            {
                expectedScale: "bytes",
                bytesToInsert: 1,
            },
            {
                expectedScale: "KB",
                bytesToInsert: 1024,
            },
            {
                expectedScale: "MB",
                bytesToInsert: 1024 * 1024,
            },
        ];
        for (const test of testCases) {
            it(`returns the size of the collection in ${test.expectedScale}`, async () => {
                await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertOne({ data: crypto.randomBytes(test.bytesToInsert) });

                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "collection-storage-size",
                    arguments: { database: integration.randomDbName(), collection: "foo" },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain(`The size of "${integration.randomDbName()}.foo" is`);
                const size = /is `(\d+\.\d+) ([a-zA-Z]*)`/.exec(content);

                expectDefined(size?.[1]);
                expectDefined(size?.[2]);
                expect(parseFloat(size?.[1] || "")).toBeGreaterThan(0);
                expect(size?.[2]).toBe(test.expectedScale);
            });
        }
    });

    validateAutoConnectBehavior(integration, "collection-storage-size", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "foo",
            },
            expectedResponse: `The size of "${integration.randomDbName()}.foo" cannot be determined because the collection does not exist.`,
        };
    });
});
