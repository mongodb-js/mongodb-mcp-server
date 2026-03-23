import z from "zod";
import { zEJSON } from "../args.js";

export const AnyAggregateStage = zEJSON();

const zCommonVectorSearchStageParams = z.object({
    exact: z
        .boolean()
        .optional()
        .default(false)
        .describe(
            "When true, uses an ENN algorithm, otherwise uses ANN. Using ENN is not compatible with numCandidates, in that case, numCandidates must be left empty."
        ),
    index: z.string().describe("Name of the index, as retrieved from the `collection-indexes` tool."),
    path: z
        .string()
        .describe("Field, in dot notation, where to search. There must be a vector search index for that field."),
    numCandidates: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Number of candidates for the ANN algorithm. Mandatory when exact is false."),
    limit: z.number().int().positive().optional().default(10),
    filter: zEJSON()
        .optional()
        .describe(
            "MQL filter that can only use filter fields from the index definition. Note to LLM: If unsure, use the `collection-indexes` tool to learn which fields can be used for filtering."
        ),
});

const zClassicVectorSearchStageParams = zCommonVectorSearchStageParams.extend({
    queryVector: z
        .array(z.number())
        .describe(
            "The vector embeddings to search for when using classic vector search indexes (type: 'vector'). Provide embeddings as an array of numbers. Use this for classic vector indexes. For auto-embed indexes (type: 'autoEmbed'), use 'query' instead."
        ),
});

export const modelsSupportingAutoEmbedIndexes = [
    "voyage-4",
    "voyage-4-large",
    "voyage-4-lite",
    "voyage-code-3",
] as const;

const zAutoEmbedVectorSearchStageParams = zCommonVectorSearchStageParams.extend({
    query: z
        .object({
            text: z.string().describe("The text query to search for."),
        })
        .describe(
            "The query to search for when using auto-embed indexes (type: 'autoEmbed'). MongoDB will automatically generate embeddings for the text at query time. Use this for auto-embed indexes, not 'queryVector'."
        ),
    model: z
        .enum(modelsSupportingAutoEmbedIndexes)
        .optional()
        .describe(
            "The embedding model to use for generating embeddings from the query text. If not specified, defaults to the model configured in the auto-embed index definition."
        ),
});

export const VectorSearchStage = z.object({
    $vectorSearch: z.union([
        zClassicVectorSearchStageParams.describe(
            "Classic vector search using 'queryVector'. Use this when the indexed field has a classic vector index (type: 'vector'). Note to LLM: Use the collection-indexes tool to verify the target field has a classic vector index before using 'queryVector'."
        ),
        zAutoEmbedVectorSearchStageParams.describe(
            "Auto-embed vector search using 'query'. Use this when the indexed field has an auto-embed index (type: 'autoEmbed'). Note to LLM: Use the collection-indexes tool to verify the target field has an auto-embed index before using 'query'."
        ),
    ]),
});
