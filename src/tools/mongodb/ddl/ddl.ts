import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import * as bson from "bson";
import { OperationType, ToolArgs } from "../../tool.js";
import z from "zod";
import { getSimplifiedSchema } from "mongodb-schema";

export class MongoDBDDLTool extends MongoDBToolBase {
    protected name = "mongodb-ddl";
    protected description =
        "List databases, collections, indexes and describe the schema of a collection in a MongoDB database";
    protected argsShape = {
        command: z.discriminatedUnion("name", [
            z
                .object({
                    name: z.literal("list-databases"),
                    parameters: z.object({}),
                })
                .describe("List all databases for a MongoDB connection"),
            z
                .object({
                    name: z.literal("list-collections"),
                    parameters: z.object({
                        database: DbOperationArgs.database,
                    }),
                })
                .describe("List all collections for a given database"),
            z
                .object({
                    name: z.literal("collection-indexes"),
                    parameters: z.object(DbOperationArgs),
                })
                .describe("Describe the indexes for a collection"),
            z
                .object({
                    name: z.literal("collection-schema"),
                    parameters: z.object(DbOperationArgs),
                })
                .describe("Describe the schema for a collection"),
        ]),
    };
    protected operationType: OperationType = "read";

    protected async execute({ command }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        if (command.name === "list-databases") {
            const dbs = (await provider.listDatabases("")).databases as { name: string; sizeOnDisk: bson.Long }[];

            return {
                content: dbs.map((db) => {
                    return {
                        text: `Name: ${db.name}, Size: ${db.sizeOnDisk.toString()} bytes`,
                        type: "text",
                    };
                }),
            };
        }

        if (command.name === "list-collections") {
            const { database } = command.parameters;
            const collections = await provider.listCollections(database);

            if (collections.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `No collections found for database "${database}". To create a collection, use the "create-collection" tool.`,
                        },
                    ],
                };
            }

            return {
                content: collections.map((collection) => {
                    return {
                        text: `Name: "${collection.name}"`,
                        type: "text",
                    };
                }),
            };
        }

        if (command.name === "collection-indexes") {
            const { database, collection } = command.parameters;
            const indexes = await provider.getIndexes(database, collection);

            return {
                content: [
                    {
                        text: `Found ${indexes.length} indexes in the collection "${collection}":`,
                        type: "text",
                    },
                    ...(indexes.map((indexDefinition) => {
                        return {
                            text: `Name "${indexDefinition.name}", definition: ${JSON.stringify(indexDefinition.key)}`,
                            type: "text",
                        };
                    }) as { text: string; type: "text" }[]),
                ],
            };
        }

        if (command.name === "collection-schema") {
            const { database, collection } = command.parameters;
            const documents = await provider.find(database, collection, {}, { limit: 5 }).toArray();
            const schema = await getSimplifiedSchema(documents);

            const fieldsCount = Object.entries(schema).length;
            if (fieldsCount === 0) {
                return {
                    content: [
                        {
                            text: `Could not deduce the schema for "${database}.${collection}". This may be because it doesn't exist or is empty.`,
                            type: "text",
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        text: `Found ${fieldsCount} fields in the schema for "${database}.${collection}"`,
                        type: "text",
                    },
                    {
                        text: JSON.stringify(schema),
                        type: "text",
                    },
                ],
            };
        }

        return {
            content: [
                {
                    text: `Unknown command provided to the tool.`,
                    type: "text",
                },
            ],
        };
    }

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        if (args.command.name === "collection-indexes") {
            if (error instanceof Error && "codeName" in error && error.codeName === "NamespaceNotFound") {
                return {
                    content: [
                        {
                            text: `The indexes for "${args.command.parameters.database}.${args.command.parameters.collection}" cannot be determined because the collection does not exist.`,
                            type: "text",
                        },
                    ],
                };
            }
        }
        return super.handleError(error, args);
    }
}
