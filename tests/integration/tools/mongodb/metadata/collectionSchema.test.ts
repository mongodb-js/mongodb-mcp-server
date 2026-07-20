import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";

import {
    getResponseElements,
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
    getDataFromUntrustedContent,
} from "../../../helpers.js";
import type { Document } from "bson";
import type { OptionalId } from "mongodb";
import type { SimplifiedSchema } from "mongodb-schema";
import type { CollectionSchemaOutput } from "../../../../../src/tools/mongodb/metadata/collectionSchema.js";
import { describe, expect, it } from "vitest";

describeWithMongoDB("collectionSchema tool", (integration) => {
    validateToolMetadata(integration, "collection-schema", "Describe the schema for a collection", "metadata", [
        ...databaseCollectionParameters,
        {
            name: "sampleSize",
            type: "number",
            description: "Number of documents to sample for schema inference",
            required: false,
        },
        {
            name: "responseBytesLimit",
            type: "number",
            description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maxBytesPerQuery and cannot be exceeded.`,
            required: false,
        },
    ]);

    validateThrowsForInvalidArguments(integration, "collection-schema", databaseCollectionInvalidArgs);

    describe("with non-existent database", () => {
        it("returns empty schema", async () => {
            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-schema",
                arguments: { connectionId, database: "non-existent", collection: "foo" },
            });
            const content = getResponseContent(response.content);
            expect(content).toEqual(
                `Could not deduce the schema for the requested namespace. This may be because it doesn't exist or is empty.`
            );

            // Structured content should have empty schema for empty collection
            const structuredContent = response.structuredContent as CollectionSchemaOutput;
            expect(structuredContent.schema).toEqual({});
            expect(structuredContent.fieldsCount).toBe(0);
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

                const connectionId = await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "collection-schema",
                    arguments: { connectionId, database: integration.randomDbName(), collection: "foo" },
                });
                const items = getResponseElements(response.content);
                expect(items).toHaveLength(2);

                // Expect to find _id, name, age
                expect(items[0]?.text).toEqual(
                    `Found ${Object.entries(testCase.expectedSchema).length} fields in the sampled schema. Note that this schema is inferred from a sample and may not represent the full schema of the collection.`
                );

                const { schema } = JSON.parse(getDataFromUntrustedContent(items[1]?.text ?? "{}")) as {
                    schema: SimplifiedSchema;
                };
                expect(schema).toEqual(testCase.expectedSchema);

                // Validate structured content matches
                const structuredContent = response.structuredContent as CollectionSchemaOutput;
                expect(structuredContent.schema).toEqual(testCase.expectedSchema);
                expect(structuredContent.fieldsCount).toBe(Object.entries(testCase.expectedSchema).length);
            });
        }

        it("returns the collection name only inside the untrusted-data block, not the description", async () => {
            const collectionName = "my sentences collection";
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).collection(collectionName).insertOne({ a: 1 });

            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-schema",
                arguments: { connectionId, database: integration.randomDbName(), collection: collectionName },
            });
            const items = getResponseElements(response.content);
            expect(items).toHaveLength(2);

            // The description is a static header and does not echo the collection name...
            expect(items[0]?.text).not.toContain(collectionName);
            // ...the name is surfaced within the untrusted-data section instead.
            expect(items[1]?.text).toContain("<untrusted-user-data-");
            expect(items[1]?.text).toContain(collectionName);
        });
    });

    describe("with a $jsonSchema validator", () => {
        it("derives the schema from the validator instead of sampling", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).createCollection("validated", {
                validator: {
                    $jsonSchema: {
                        bsonType: "object",
                        required: ["name"],
                        properties: {
                            name: { bsonType: "string" },
                            age: { bsonType: "int" },
                            address: {
                                bsonType: "object",
                                properties: {
                                    city: { bsonType: "string" },
                                    zip: { bsonType: ["string", "null"] },
                                },
                            },
                            tags: { bsonType: "array", items: { bsonType: "string" } },
                        },
                    },
                },
            });

            const expectedSchema: SimplifiedSchema = {
                name: { types: [{ bsonType: "String" }] },
                age: { types: [{ bsonType: "Int32" }] },
                address: {
                    types: [
                        {
                            bsonType: "Document",
                            fields: {
                                city: { types: [{ bsonType: "String" }] },
                                zip: { types: [{ bsonType: "String" }, { bsonType: "Null" }] },
                            },
                        },
                    ],
                },
                tags: { types: [{ bsonType: "Array", types: [{ bsonType: "String" }] }] },
            };

            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-schema",
                arguments: { connectionId, database: integration.randomDbName(), collection: "validated" },
            });
            const items = getResponseElements(response.content);
            expect(items).toHaveLength(2);

            expect(items[0]?.text).toEqual(
                `Found ${Object.entries(expectedSchema).length} fields derived from the collection's schema validator.`
            );

            const { schema } = JSON.parse(getDataFromUntrustedContent(items[1]?.text ?? "{}")) as {
                schema: SimplifiedSchema;
            };
            expect(schema).toEqual(expectedSchema);

            const structuredContent = response.structuredContent as CollectionSchemaOutput;
            expect(structuredContent.schema).toEqual(expectedSchema);
            expect(structuredContent.fieldsCount).toBe(Object.entries(expectedSchema).length);
        });

        it("falls back to sampling when the validator has no $jsonSchema", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db(integration.randomDbName()).createCollection("queryValidated", {
                validator: { age: { $gte: 18 } },
            });
            await mongoClient
                .db(integration.randomDbName())
                .collection("queryValidated")
                .insertOne({ name: "Alice", age: 30 });

            const connectionId = await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({
                name: "collection-schema",
                arguments: { connectionId, database: integration.randomDbName(), collection: "queryValidated" },
            });
            const items = getResponseElements(response.content);
            expect(items[0]?.text).toContain("inferred from a sample");
        });
    });

    validateAutoConnectBehavior(integration, "collection-schema", () => {
        return {
            args: {
                database: integration.randomDbName(),
                collection: "new-collection",
            },
            expectedResponse: `Could not deduce the schema for the requested namespace. This may be because it doesn't exist or is empty.`,
        };
    });
});
