import {
    getResponseElements,
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
    getDataFromUntrustedContent,
    expectDefined,
} from "../../../integrationHelpers.js";
import { describeWithMongoDB, validateAutoConnectBehavior } from "../../../mongodbHelpers.js";
import type { Document } from "bson";
import { MongoServerError, type OptionalId } from "mongodb";
import type { SimplifiedSchema } from "@mongodb-js/mongodb-schema";
import type { CollectionSchemaOutput } from "@mongodb-js/mcp-tools-mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
describeWithMongoDB({
    name: "collectionSchema tool",
    fn: (integration) => {
        validateToolMetadata({
            integration,
            name: "collection-schema",
            description: "Describe the schema for a collection",
            operationType: "metadata",
            parameters: [
                ...databaseCollectionParameters,
                {
                    name: "schemaSource",
                    type: "string",
                    description:
                        "Where to derive the schema from. 'auto' uses the collection's $jsonSchema validator when it is strictly enforced, otherwise samples documents. 'validator' only uses the validator. 'sample' always samples documents.",
                    required: false,
                },
                {
                    name: "sampleSize",
                    type: "number",
                    description:
                        "Number of documents to sample for schema inference. Ignored when the schema comes from the validator.",
                    required: false,
                },
                {
                    name: "responseBytesLimit",
                    type: "number",
                    description: `The maximum number of bytes to return in the response. This value is capped by the server's configured maximum and cannot be exceeded. Ignored when the schema comes from the validator.`,
                    required: false,
                },
            ],
        });
        validateThrowsForInvalidArguments({
            integration,
            name: "collection-schema",
            args: databaseCollectionInvalidArgs,
        });
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
                expect(structuredContent.source).toBe("sample");
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
                    await mongoClient
                        .db(integration.randomDbName())
                        .collection("foo")
                        .insertMany(testCase.insertionData);
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
                    expect(structuredContent.source).toBe("sample");
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
            const closedSchema = {
                bsonType: "object",
                required: ["_id", "name"],
                additionalProperties: false,
                properties: {
                    _id: { bsonType: "objectId" },
                    name: { bsonType: "string" },
                    age: { bsonType: ["int", "null"] },
                },
            };
            const closedSchemaExpected = {
                _id: { types: [{ bsonType: "ObjectId" }] },
                name: { types: [{ bsonType: "String" }] },
                age: { types: [{ bsonType: "Int32" }, { bsonType: "Null" }] },
            };
            const openSchema = {
                bsonType: "object",
                properties: { name: { bsonType: "string" } },
            };

            async function createCollection(options: Document): Promise<void> {
                await integration.mongoClient().db(integration.randomDbName()).createCollection("foo", options);
            }

            async function callTool(
                schemaSource?: string,
                existingConnectionId?: string
            ): Promise<{
                items: ReturnType<typeof getResponseElements>;
                structuredContent: CollectionSchemaOutput;
                isError?: boolean;
            }> {
                const connectionId = existingConnectionId ?? (await integration.connectMcpClient());
                const response = await integration.mcpClient().callTool({
                    name: "collection-schema",
                    arguments: {
                        connectionId,
                        database: integration.randomDbName(),
                        collection: "foo",
                        ...(schemaSource && { schemaSource }),
                    },
                });
                return {
                    items: getResponseElements(response.content),
                    structuredContent: response.structuredContent as CollectionSchemaOutput,
                    isError: response.isError,
                };
            }

            it("uses an enforced validator with additionalProperties: false", async () => {
                await createCollection({ validator: { $jsonSchema: closedSchema } });

                const { items, structuredContent } = await callTool();
                expect(items[0]?.text).toEqual(
                    "Found 3 fields in the schema defined by the collection's $jsonSchema validator. Note that documents inserted before the validator was added may not conform to it."
                );
                expect(structuredContent).toEqual({
                    schema: closedSchemaExpected,
                    fieldsCount: 3,
                    source: "validator",
                });
            });

            it("merges an enforced validator that allows additional properties with sampled documents", async () => {
                await createCollection({ validator: { $jsonSchema: openSchema } });
                await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertOne({ name: "Alice", country: "UK" });

                const { items, structuredContent } = await callTool();
                expect(items[0]?.text).toContain(
                    "Found 3 fields in the schema. Fields declared by the collection's $jsonSchema validator"
                );
                expect(structuredContent).toEqual({
                    schema: {
                        _id: { types: [{ bsonType: "ObjectId" }] },
                        name: { types: [{ bsonType: "String" }] },
                        country: { types: [{ bsonType: "String" }] },
                    },
                    fieldsCount: 3,
                    source: "merged",
                });
            });

            it("merges nested fields when only the root of the validator is closed", async () => {
                await createCollection({
                    validator: {
                        $jsonSchema: {
                            bsonType: "object",
                            additionalProperties: false,
                            properties: {
                                _id: { bsonType: "objectId" },
                                address: { bsonType: "object", properties: { city: { bsonType: "string" } } },
                            },
                        },
                    },
                });
                await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertOne({ address: { city: "London", zip: "N1" } });

                const { structuredContent } = await callTool();
                expect(structuredContent).toEqual({
                    schema: {
                        _id: { types: [{ bsonType: "ObjectId" }] },
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
                    },
                    fieldsCount: 2,
                    source: "merged",
                });
            });

            it("samples documents when the validator is not strictly enforced", async () => {
                await createCollection({ validator: { $jsonSchema: closedSchema }, validationAction: "warn" });
                await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertOne({ title: "x" });

                const { structuredContent } = await callTool();
                expect(structuredContent.source).toBe("sample");
                expect(Object.keys(structuredContent.schema)).toEqual(["_id", "title"]);
            });

            it("uses a non-enforced validator when schemaSource is 'validator'", async () => {
                await createCollection({ validator: { $jsonSchema: closedSchema }, validationLevel: "moderate" });

                const { items, structuredContent } = await callTool("validator");
                expect(items[0]?.text).toEqual(
                    "Found 3 fields in the schema defined by the collection's $jsonSchema validator. Note that the validator is not strictly enforced (validationLevel: moderate, validationAction: error), so documents may not conform to it."
                );
                expect(structuredContent).toEqual({
                    schema: closedSchemaExpected,
                    fieldsCount: 3,
                    source: "validator",
                });
            });

            it("ignores the validator when schemaSource is 'sample'", async () => {
                await createCollection({ validator: { $jsonSchema: closedSchema } });
                await integration
                    .mongoClient()
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertOne({ name: "Alice" });

                const { structuredContent } = await callTool("sample");
                expect(structuredContent).toEqual({
                    schema: {
                        _id: { types: [{ bsonType: "ObjectId" }] },
                        name: { types: [{ bsonType: "String" }] },
                    },
                    fieldsCount: 2,
                    source: "sample",
                });
            });

            it("returns an error when schemaSource is 'validator' and there is no validator", async () => {
                await createCollection({});

                const { items, isError } = await callTool("validator");
                expect(isError).toBe(true);
                expect(items[0]?.text).toEqual(
                    "The requested namespace does not have a $jsonSchema validator. Use schemaSource 'sample' to infer the schema from documents instead."
                );
            });

            it("returns an error when schemaSource is 'validator' and the namespace does not exist", async () => {
                const { items, isError } = await callTool("validator");
                expect(isError).toBe(true);
                expect(items[0]?.text).toEqual("The requested namespace does not exist.");
            });

            describe("when the validator cannot be read", () => {
                afterEach(() => {
                    vi.restoreAllMocks();
                });

                async function connectWithFailingListCollections(): Promise<string> {
                    const connectionId = await integration.connectMcpClient();
                    const entry = await integration.mcpServer().connectionRegistry.peek(connectionId);
                    expectDefined(entry);
                    vi.spyOn(entry.getServiceProvider(), "listCollections").mockRejectedValue(
                        new MongoServerError({ message: "not authorized", codeName: "Unauthorized" })
                    );
                    return connectionId;
                }

                it("returns an error when schemaSource is 'validator'", async () => {
                    await createCollection({ validator: { $jsonSchema: closedSchema } });
                    const connectionId = await connectWithFailingListCollections();

                    const { items, isError } = await callTool("validator", connectionId);
                    expect(isError).toBe(true);
                    expect(items[0]?.text).toEqual(
                        "Could not read the validator for the requested namespace. This may be because the current user lacks the listCollections privilege on the database. Use schemaSource 'sample' to infer the schema from documents instead."
                    );
                });

                it("falls back to sampling when schemaSource is 'auto'", async () => {
                    await createCollection({ validator: { $jsonSchema: closedSchema } });
                    await integration
                        .mongoClient()
                        .db(integration.randomDbName())
                        .collection("foo")
                        .insertOne({ name: "Alice" });
                    const connectionId = await connectWithFailingListCollections();

                    const { structuredContent } = await callTool(undefined, connectionId);
                    expect(structuredContent.source).toBe("sample");
                    expect(Object.keys(structuredContent.schema)).toEqual(["_id", "name"]);
                });
            });
        });
        validateAutoConnectBehavior({
            integration,
            name: "collection-schema",
            validation: () => {
                return {
                    args: {
                        database: integration.randomDbName(),
                        collection: "new-collection",
                    },
                    expectedResponse: `Could not deduce the schema for the requested namespace. This may be because it doesn't exist or is empty.`,
                };
            },
        });
    },
});
