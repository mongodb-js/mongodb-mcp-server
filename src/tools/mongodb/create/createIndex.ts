import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import type { IndexDirection } from "mongodb";
import { quantizationEnum } from "../../../common/search/vectorSearchEmbeddingsManager.js";
import { similarityValues } from "../../../common/schemas.js";

export class CreateIndexTool extends MongoDBToolBase {
    private vectorSearchIndexDefinition = z.object({
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
                            similarity: z
                                .enum(similarityValues)
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
    });

    public name = "create-index";
    protected description = "Create an index for a collection";
    protected argsShape = {
        ...DbOperationArgs,
        name: z.string().optional().describe("The name of the index"),
        definition: z
            .array(
                z.discriminatedUnion("type", [
                    z.object({
                        type: z.literal("classic"),
                        keys: z.object({}).catchall(z.custom<IndexDirection>()).describe("The index definition"),
                    }),
                    ...(this.isFeatureEnabled("vectorSearch") ? [this.vectorSearchIndexDefinition] : []),
                ])
            )
            .describe(
                "The index definition. Use 'classic' for standard indexes and 'vectorSearch' for vector search indexes"
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
