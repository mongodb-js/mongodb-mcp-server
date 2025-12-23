import z from "zod";
import { zEJSON } from "../args.js";

export const zVoyageModels = z
    .enum(["voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"])
    .default("voyage-3-large");

export const zVoyageEmbeddingParameters = z.object({
    // OpenAPI JSON Schema supports enum only as string so the public facing
    // parameters that are fed to LLM providers should expect the dimensions as
    // stringified numbers which are then transformed to actual numbers.
    outputDimension: z
        .union([z.literal("256"), z.literal("512"), z.literal("1024"), z.literal("2048"), z.literal("4096")])
        .default("1024")
        .transform((value): number => Number.parseInt(value))
        .optional(),
    outputDtype: z.enum(["float", "int8", "uint8", "binary", "ubinary"]).optional().default("float"),
});

export const zVoyageAPIParameters = zVoyageEmbeddingParameters
    .extend({
        // Unlike public facing parameters, `zVoyageEmbeddingParameters`, the
        // api parameters need to be correct number and because we do an
        // additional parsing before calling the API, we override the
        // outputDimension schema to expect a union of numbers.
        outputDimension: z
            .union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)])
            .default(1024)
            .optional(),
        inputType: z.enum(["query", "document"]),
    })
    .strip();

export type VoyageModels = z.infer<typeof zVoyageModels>;
export type VoyageEmbeddingParameters = z.infer<typeof zVoyageEmbeddingParameters> & EmbeddingParameters;

export type EmbeddingParameters = {
    inputType: "query" | "document";
};

export const zSupportedEmbeddingParameters = zVoyageEmbeddingParameters.extend({ model: zVoyageModels });
export type SupportedEmbeddingParameters = z.infer<typeof zSupportedEmbeddingParameters>;

export const AnyAggregateStage = zEJSON();
export const VectorSearchStage = z.object({
    $vectorSearch: z
        .object({
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
                .describe(
                    "Field, in dot notation, where to search. There must be a vector search index for that field. Note to LLM: When unsure, use the 'collection-indexes' tool to validate that the field is indexed with a vector search index."
                ),
            queryVector: z
                .union([z.string(), z.array(z.number())])
                .optional()
                .describe(
                    "The content to search for when querying indexes that require manual embedding generation. Provide an array of numbers (embeddings) or a string with embeddingParameters. Do not use this for auto-embedding indexes; use 'query' instead."
                ),
            query: z
                .object({
                    text: z.string().describe("The text query to search for."),
                })
                .optional()
                .describe(
                    "The query to search for when using auto-embedding indexes. MongoDB will automatically generate embeddings for the text. Use this for auto-embedding indexes, not 'queryVector'."
                ),
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
            embeddingParameters: zSupportedEmbeddingParameters
                .optional()
                .describe(
                    "The embedding model and its parameters to use to generate embeddings before searching. Only provide this when using 'queryVector' with a string value for indexes that require manual embedding generation. Do not provide this for auto-embedding indexes that use 'query'. Note to LLM: If unsure, ask the user before providing one."
                ),
        })
        .passthrough()
        .refine((data) => (data.queryVector !== undefined) !== (data.query !== undefined), {
            message: "Either 'queryVector' or 'query' must be provided, but not both.",
        }),
});
