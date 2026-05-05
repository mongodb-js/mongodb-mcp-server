import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult, ToolExecutionContext } from "@mongodb-js/mcp-core";
import { IndexDirectionSchema } from "../mongodbSchemas.js";

const CreateIndexOutputSchema = {
    database: z.string(),
    collection: z.string(),
    indexName: z.string(),
    indexType: z.enum(["classic", "vectorSearch", "search"]),
};

export type CreateIndexOutput = z.infer<z.ZodObject<typeof CreateIndexOutputSchema>>;

// Classic index definition
const ClassicIndexDefinition = z.object({
    type: z.literal("classic"),
    keys: z.record(z.string(), IndexDirectionSchema),
});

// Vector search field types
const VectorField = z.object({
    type: z.literal("vector"),
    path: z.string(),
    numDimensions: z.number().optional(),
    similarity: z.enum(["cosine", "euclidean", "dotProduct"]).optional(),
});

const FilterField = z.object({
    type: z.literal("filter"),
    path: z.string(),
});

const AutoEmbedField = z.object({
    type: z.literal("autoEmbed"),
    path: z.string(),
});

const VectorSearchField = z.union([VectorField, FilterField, AutoEmbedField]);

// Vector search index definition
const VectorSearchIndexDefinition = z.object({
    type: z.literal("vectorSearch"),
    fields: z.array(VectorSearchField),
});

// Atlas Search index definition
const SearchIndexDefinition = z.object({
    type: z.literal("search"),
});

// Union of all index definitions
const IndexDefinition = z.union([ClassicIndexDefinition, VectorSearchIndexDefinition, SearchIndexDefinition]);

export class CreateIndexTool extends MongoDBToolBase {
    static toolName = "create-index";
    public description = "Create an index on a MongoDB collection";
    public override outputSchema = CreateIndexOutputSchema;
    public argsShape = {
        ...CollOperationArgs,
        indexName: z.string().optional().describe("Name of the index to create (optional for classic indexes)"),
        definition: z.array(IndexDefinition).describe("Index definition(s) to create"),
    };
    static operationType: OperationType = "create";

    protected async execute(
        { database, collection, indexName, definition }: ToolArgs<typeof this.argsShape>,
        { signal }: ToolExecutionContext
    ): Promise<ToolResult<typeof this.outputSchema>> {
        const provider = await this.ensureConnected();

        // For now, we only support single index creation
        const indexDef = definition[0];
        if (!indexDef) {
            throw new Error("At least one index definition is required");
        }

        if (indexDef.type === "classic") {
            const name = indexName || this.generateIndexName(indexDef.keys);
            await provider.createIndexes(
                database,
                collection,
                [
                    {
                        name,
                        key: indexDef.keys,
                    },
                ],
                {
                    ...this.getOperationOptions(signal),
                }
            );

            return {
                content: [
                    {
                        text: `Index "${name}" created on collection "${collection}" in database "${database}".`,
                        type: "text",
                    },
                ],
                structuredContent: {
                    database,
                    collection,
                    indexName: name,
                    indexType: "classic" as const,
                },
            };
        }

        // For vector search and search indexes
        const name = indexName || "default";
        const indexType = indexDef.type === "vectorSearch" ? "vectorSearch" : "search";

        // Create search index via runCommandWithCheck
        await provider.runCommandWithCheck(
            database,
            {
                createSearchIndexes: collection,
                indexes: [
                    {
                        name,
                        definition: indexDef.type === "vectorSearch" ? { fields: indexDef.fields } : {},
                    },
                ],
            },
            {
                ...this.getOperationOptions(signal),
            }
        );

        return {
            content: [
                {
                    text: `Created the index "${name}" on collection "${collection}" in database "${database}". Since this is a ${indexType} index, it may take a while for the index to build. Use the \`collection-indexes\` tool to check the index status.`,
                    type: "text",
                },
            ],
            structuredContent: {
                database,
                collection,
                indexName: name,
                indexType,
            },
        };
    }

    private generateIndexName(keys: Record<string, unknown>): string {
        return Object.entries(keys)
            .map(([key, value]) => `${key.replace(/\./g, "_")}_${String(value)}`)
            .join("_");
    }
}
