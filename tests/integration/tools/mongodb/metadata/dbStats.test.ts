import { ObjectId } from "bson";
import {
    databaseParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseInvalidArgs,
    getResponseElements,
} from "../../../helpers.js";
import * as crypto from "crypto";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

describeWithMongoDB("dbStats tool", (integration) => {
    validateToolMetadata(
        integration,
        "db-stats",
        "Returns statistics that reflect the use state of a single database",
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

            const stats = JSON.parse(elements[1]?.text ?? "{}") as {
                db: string;
                collections: number;
                storageSize: number;
            };
            expect(stats.db).toBe(integration.randomDbName());
            expect(stats.collections).toBe(0);
            expect(stats.storageSize).toBe(0);
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

                const stats = JSON.parse(elements[1]?.text ?? "{}") as {
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
});
