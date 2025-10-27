import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import type { IndexDirection } from "mongodb";
import { quantizationEnum, similarityEnum } from "../../../common/search/vectorSearchEmbeddingsManager.js";

export class CreateIndexTool extends MongoDBToolBase {
    private vectorSearchIndexDefinition = z
        .object({
            type: z.literal("vectorSearch"),
            fields: z
                .array(
                    z.discriminatedUnion("type", [
                        z
                            .object({
                                type: z.literal("filter"),
                                path: z
                                    .string()
                                    .describe(
                                        "Name of the field to index. For nested fields, use dot notation to specify path to embedded fields"
                                    ),
                            })
                            .strict()
                            .describe("Definition for a field that will be used for pre-filtering results."),
                        z
                            .object({
                                type: z.literal("vector"),
                                path: z
                                    .string()
                                    .describe(
                                        "Name of the field to index. For nested fields, use dot notation to specify path to embedded fields"
                                    ),
                                numDimensions: z
                                    .number()
                                    .min(1)
                                    .max(8192)
                                    .default(this.config.vectorSearchDimensions)
                                    .describe(
                                        "Number of vector dimensions that MongoDB Vector Search enforces at index-time and query-time"
                                    ),
                                similarity: similarityEnum
                                    .default(this.config.vectorSearchSimilarityFunction)
                                    .describe(
                                        "Vector similarity function to use to search for top K-nearest neighbors. You can set this field only for vector-type fields."
                                    ),
                                quantization: quantizationEnum
                                    .default("none")
                                    .describe(
                                        "Type of automatic vector quantization for your vectors. Use this setting only if your embeddings are float or double vectors."
                                    ),
                            })
                            .strict()
                            .describe("Definition for a field that contains vector embeddings."),
                    ])
                )
                .nonempty()
                .refine((fields) => fields.some((f) => f.type === "vector"), {
                    message: "At least one vector field must be defined",
                })
                .describe(
                    "Definitions for the vector and filter fields to index, one definition per document. You must specify `vector` for fields that contain vector embeddings and `filter` for additional fields to filter on. At least one vector-type field definition is required."
                ),
        })
        .describe("Definition for a Vector Search index.");

    private atlasSearchIndexDefinition = z
        .object({
            type: z.literal("search"),
            analyzer: z
                .string()
                .optional()
                .default("lucene.standard")
                .describe(
                    "The analyzer to use for the index. Can be one of the built-in lucene analyzers (`lucene.standard`, `lucene.simple`, `lucene.whitespace`, `lucene.keyword`), a language-specific analyzer, such as `lucene.cjk` or `lucene.czech`, or a custom analyzer defined in the Atlas UI."
                ),
            mappings: z
                .object({
                    dynamic: z
                        .boolean()
                        .optional()
                        .default(false)
                        .describe(
                            "Enables or disables dynamic mapping of fields for this index. If set to true, Atlas Search recursively indexes all dynamically indexable fields. If set to false, you must specify individual fields to index using mappings.fields."
                        ),
                    fields: z
                        .record(
                            z.string().describe("The field name"),
                            z
                                .object({
                                    type: z
                                        .enum([
                                            "autocomplete",
                                            "boolean",
                                            "date",
                                            "document",
                                            "embeddedDocuments",
                                            "geo",
                                            "number",
                                            "objectId",
                                            "string",
                                            "token",
                                            "uuid",
                                        ])
                                        .describe("The field type"),
                                })
                                .passthrough()
                                .describe(
                                    "The field index definition. It must contain the field type, as well as any additional options for that field type."
                                )
                        )
                        .optional()
                        .describe("The field mapping definitions. If `dynamic` is set to `false`, this is required."),
                })
                .refine((data) => data.dynamic !== !!(data.fields && Object.keys(data.fields).length > 0), {
                    message:
                        "Either `mappings.dynamic` must be true or at least one field must be defined in `mappings.fields`",
                })
                .describe(
                    "Document describing the index to create. Either `dynamic` must be true or at least one field must be defined in the `fields` document."
                ),
        })
        .describe("Definition for an Atlas Search (lexical) index.");

    public name = "create-index";
    protected description = "Create an index for a collection";
    protected argsShape = {
        ...DbOperationArgs,
        name: z.string().optional().describe("The name of the index"),
        definition: z
            .array(
                z.discriminatedUnion("type", [
                    z
                        .object({
                            type: z.literal("classic"),
                            keys: z.object({}).catchall(z.custom<IndexDirection>()).describe("The index definition"),
                        })
                        .describe("Definition for a MongoDB index (e.g. ascending/descending/geospatial)."),
                    ...(this.isFeatureEnabled("vectorSearch")
                        ? [this.vectorSearchIndexDefinition, this.atlasSearchIndexDefinition]
                        : []),
                ])
            )
            .describe(
                "The index definition. Use 'classic' for standard indexes, 'vectorSearch' for vector search indexes, and 'search' for Atlas Search (lexical) indexes."
            ),
    };

    public operationType: OperationType = "create";

    protected async execute({
        database,
        collection,
        name,
        definition: definitions,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        let indexes: string[] = [];
        const definition = definitions[0];
        if (!definition) {
            throw new Error("Index definition not provided. Expected one of the following: `classic`, `vectorSearch`");
        }

        let responseClarification = "";

        switch (definition.type) {
            case "classic":
                indexes = await provider.createIndexes(database, collection, [
                    {
                        key: definition.keys,
                        name,
                    },
                ]);
                break;
            case "vectorSearch":
                {
                    await this.ensureSearchIsSupported();
                    indexes = await provider.createSearchIndexes(database, collection, [
                        {
                            name,
                            definition: {
                                fields: definition.fields,
                            },
                            type: "vectorSearch",
                        },
                    ]);

                    responseClarification =
                        " Since this is a vector search index, it may take a while for the index to build. Use the `list-indexes` tool to check the index status.";

                    // clean up the embeddings cache so it considers the new index
                    this.session.vectorSearchEmbeddingsManager.cleanupEmbeddingsForNamespace({ database, collection });
                }

                break;
            case "search":
                {
                    await this.ensureSearchIsSupported();
                    indexes = await provider.createSearchIndexes(database, collection, [
                        {
                            name,
                            definition: {
                                mappings: definition.mappings,
                                analyzer: definition.analyzer,
                            },
                            type: "search",
                        },
                    ]);

                    responseClarification =
                        " Since this is a search index, it may take a while for the index to build. Use the `list-indexes` tool to check the index status.";
                }

                break;
        }

        return {
            content: [
                {
                    text: `Created the index "${indexes[0]}" on collection "${collection}" in database "${database}".${responseClarification}`,
                    type: "text",
                },
            ],
        };
    }
}
