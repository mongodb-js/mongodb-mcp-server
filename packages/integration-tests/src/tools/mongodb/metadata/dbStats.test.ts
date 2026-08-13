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
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "db-stats",
                arguments: { connectionId, database: integration.randomDbName() },
            });
            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toBe(`Statistics for database:`);

            const json = getDataFromUntrustedContent(elements[1]?.text ?? "{}");
            const { stats } = JSON.parse(json) as {
                stats: {
                    db: string;
                    collections: unknown;
                    storageSize: unknown;
                };
            };
            expect(stats.db).toBe(integration.randomDbName());
            expectIdiomaticNumber(stats.collections, 0);
            expectIdiomaticNumber(stats.storageSize, 0);

            const structuredContent = response.structuredContent as DbStatsOutput;
            expect(structuredContent.stats).toEqual(stats);
            expect((structuredContent.stats as typeof stats).db).toBe(stats.db);
        });
    });

    describe("with existing database", () => {
        const testCases: Array<{ collections: Record<string, number>; name: string }> = [
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

                const connectionId = await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "db-stats",
                    arguments: { connectionId, database: integration.randomDbName() },
                });
                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(2);
                expect(elements[0]?.text).toBe(`Statistics for database:`);

                const { stats } = JSON.parse(getDataFromUntrustedContent(elements[1]?.text ?? "{}")) as {
                    stats: {
                        db: string;
                        collections: unknown;
                        storageSize: unknown;
                        objects: unknown;
                    };
                };
                expect(stats.db).toBe(integration.randomDbName());
                expectIdiomaticNumber(stats.collections, Object.entries(test.collections).length);
                expectIdiomaticNumber(stats.storageSize, 1024, { greaterThan: true });
                const expectedObjectCount = Object.values(test.collections).reduce<number>(
                    (sum, count) => sum + count,
                    0
                );
                expectIdiomaticNumber(stats.objects, expectedObjectCount);

                const structuredContent = response.structuredContent as DbStatsOutput;
                expect(structuredContent.stats).toEqual(stats);
            });
        }
    });

    validateAutoConnectBehavior(integration, "db-stats", () => {
        return {
            args: {
                database: integration.randomDbName(),
            },
            expectedResponse: `Statistics for database:`,
        };
    });

    function expectIdiomaticNumber(value: unknown, expected: number, options?: { greaterThan?: boolean }): void {
        const assertValue = (actual: number): void => {
            if (options?.greaterThan) {
                expect(actual).toBeGreaterThan(expected);
            } else {
                expect(actual).toBe(expected);
            }
        };

        if (typeof value === "number") {
            assertValue(value);
            return;
        }

        if (
            typeof value === "object" &&
            value !== null &&
            "$numberLong" in value &&
            typeof (value as { $numberLong: unknown }).$numberLong === "string"
        ) {
            assertValue(Number((value as { $numberLong: string }).$numberLong));
            return;
        }

        expect(value).toEqual(Long.fromNumber(expected));
    }
});
