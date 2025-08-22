import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseElements,
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
} from "../../../helpers.js";
import type { Document } from "bson";
import type { OptionalId } from "mongodb";
import type { SimplifiedSchema } from "mongodb-schema";
import { describe, expect, it } from "vitest";

describeWithMongoDB("collectionSchema tool", (integration) => {
    validateToolMetadata(
        integration,
        "collection-schema",
        "Describe the schema for a collection",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "collection-schema", databaseCollectionInvalidArgs);

    describe("with non-existent database", () => {
        it("returns empty schema", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-schema",
                arguments: { database: "non-existent", collection: "foo" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Could not deduce the schema for "non-existent.foo". This may be because it doesn't exist or is empty.`
            );
        });
    });

    describe("with existing database", () => {
        const testCases: Array<{
            insertionData: OptionalId<Document>[];
            name: string;
            expectedSchema: SimplifiedSchema;
        }> = [
            {
                name: "homogenous schema",
                insertionData: [
                    { name: "Alice", age: 30 },
                    { name: "Bob", age: 25 },
                ],
                expectedSchema: {
                    _id: {
                        types: [{ bsonType: "ObjectId" }],
                    },
                    name: {
                        types: [{ bsonType: "String" }],
                    },
                    age: {
                        //@ts-expect-error This is a workaround
                        types: [{ bsonType: "Number" }],
                    },
                },
            },
            {
                name: "heterogenous schema",
                insertionData: [
                    { name: "Alice", age: 30 },
                    { name: "Bob", age: "25", country: "UK" },
                    { name: "Charlie", country: "USA" },
                    { name: "Mims", age: 25, country: false },
                ],
                expectedSchema: {
                    _id: {
                        types: [{ bsonType: "ObjectId" }],
                    },
                    name: {
                        types: [{ bsonType: "String" }],
                    },
                    age: {
                        // @ts-expect-error This is a workaround
                        types: [{ bsonType: "Number" }, { bsonType: "String" }],
                    },
                    country: {
                        types: [{ bsonType: "String" }, { bsonType: "Boolean" }],
                    },
                },
            },
            {
                name: "schema with nested documents",
                insertionData: [
                    { name: "Alice", address: { city: "New York", zip: "10001" }, ageRange: [18, 30] },
                    { name: "Bob", address: { city: "Los Angeles" }, ageRange: "25-30" },
                    { name: "Charlie", address: { city: "Chicago", zip: "60601" }, ageRange: [20, 35] },
                ],
                expectedSchema: {
                    _id: {
                        types: [{ bsonType: "ObjectId" }],
                    },
                    name: {
                        types: [{ bsonType: "String" }],
                    },
                    address: {
                        types: [
                            {
                                bsonType: "Document",
                                fields: {
                                    city: { types: [{ bsonType: "String" }] },
                                    zip: { types: [{ bsonType: "String" }] },
                                },
                            },
                        ],
                    },
                    ageRange: {
                        // @ts-expect-error This is a workaround
                        types: [{ bsonType: "Array", types: [{ bsonType: "Number" }] }, { bsonType: "String" }],
                    },
                },
            },
        ];

        for (const testCase of testCases) {
            it(`returns ${testCase.name}`, async () => {
                const mongoClient = integration.mongoClient();
                await mongoClient.db(integration.randomDbName()).collection("foo").insertMany(testCase.insertionData);

                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "collection-schema",
                    arguments: { database: integration.randomDbName(), collection: "foo" },
                });
                const items = getResponseElements(response.content);
                expect(items).toHaveLength(2);

                // Expect to find _id, name, age
                expect(items[0]?.text).toEqual(
                    `Found ${Object.entries(testCase.expectedSchema).length} fields in the schema for "${integration.randomDbName()}.foo"`
                );

                const schema = JSON.parse(items[1]?.text ?? "{}") as SimplifiedSchema;
                expect(schema).toEqual(testCase.expectedSchema);
            });
        }
    });

    validateAutoConnectBehavior(integration, "collection-schema", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "new-collection",
            },
            expectedResponse: `Could not deduce the schema for "${integration.randomDbName()}.new-collection". This may be because it doesn't exist or is empty.`,
        };
    });
});
