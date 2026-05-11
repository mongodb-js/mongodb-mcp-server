import { ObjectId, Long } from "bson";
import {
    databaseParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseInvalidArgs,
    getResponseElements,
    getDataFromUntrustedContent,
} from "../../../helpers.js";
import type { DbStatsOutput } from "../../../../../src/tools/mongodb/metadata/dbStats.js";
import * as crypto from "crypto";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { describe, expect, it } from "vitest";

describeWithMongoDB("dbStats tool", (integration) => {
    validateToolMetadata(
        integration,
        "db-stats",
        "Returns statistics that reflect the use state of a single database",
        "metadata",
        databaseParameters
    );

    validateThrowsForInvalidArguments(integration, "db-stats", databaseInvalidArgs);

    describe("with non-existent database", () => {
        it("returns an error", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "db-stats",
                arguments: { database: integration.randomDbName() },
            });
            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toBe(`Statistics for database ${integration.randomDbName()}`);

            const json = getDataFromUntrustedContent(elements[1]?.text ?? "{}");
            const stats = JSON.parse(json) as {
                db: string;
                collections: number;
                storageSize: number;
            };
            expect(stats.db).toBe(integration.randomDbName());
            expect(stats.collections).toBe(0);
            expect(stats.storageSize).toBe(0);

            // Validate structured content - compare specific fields since BSON types differ from JSON
            const structuredContent = response.structuredContent as DbStatsOutput;
            expect(structuredContent.stats.db).toBe(stats.db);

            expectLongOrNumber(structuredContent.stats.collections, stats.collections);
            expectLongOrNumber(structuredContent.stats.storageSize, stats.storageSize);
        });
    });

    describe("with existing database", () => {
        const testCases = [
            {
                collections: {
                    foos: 3,
                },
                name: "single collection",
            },
            {
                collections: {
                    foos: 2,
                    bars: 5,
                },
                name: "multiple collections",
            },
        ];
        for (const test of testCases) {
            it(`returns correct stats for ${test.name}`, async () => {
                for (const [name, count] of Object.entries(test.collections)) {
                    const objects = Array(count)
                        .fill(0)
                        .map(() => {
                            return { data: crypto.randomBytes(1024), _id: new ObjectId() };
                        });
                    await integration.mongoClient().db(integration.randomDbName()).collection(name).insertMany(objects);
                }

                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "db-stats",
                    arguments: { database: integration.randomDbName() },
                });
                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(2);
                expect(elements[0]?.text).toBe(`Statistics for database ${integration.randomDbName()}`);

                const stats = JSON.parse(getDataFromUntrustedContent(elements[1]?.text ?? "{}")) as {
                    db: string;
                    collections: unknown;
                    storageSize: unknown;
                    objects: unknown;
                };
                expect(stats.db).toBe(integration.randomDbName());
                expect(stats.collections).toBe(Object.entries(test.collections).length);
                expect(stats.storageSize).toBeGreaterThan(1024);
                // eslint-disable-next-line @typescript-eslint/no-unsafe-return
                expect(stats.objects).toBe(Object.values(test.collections).reduce((a, b) => a + b, 0));

                // Validate structured content - compare specific fields since BSON types differ from JSON
                const structuredContent = response.structuredContent as DbStatsOutput;
                expect(structuredContent.stats.db).toBe(stats.db);
                expectLongOrNumber(structuredContent.stats.collections, stats.collections as number);
                expectLongOrNumber(structuredContent.stats.storageSize, stats.storageSize as number);
                expectLongOrNumber(structuredContent.stats.objects, stats.objects as number);
            });
        }
    });

    validateAutoConnectBehavior(integration, "db-stats", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "foo",
            },
            expectedResponse: `Statistics for database ${integration.randomDbName()}`,
        };
    });

    function expectLongOrNumber(value: unknown, expected: number): void {
        if (typeof value === "number") {
            expect(value).toBe(expected);
        } else {
            expect(value).toEqual(Long.fromNumber(expected));
        }
    }
});
