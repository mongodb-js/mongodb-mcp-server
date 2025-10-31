import z from "zod";
import { zEJSON } from "../args.js";

export const zVoyageModels = z
    .enum(["voyage-3-large", "voyage-3.5", "voyage-3.5-lite", "voyage-code-3"])
    .default("voyage-3-large");

// Zod does not undestand JS boxed numbers (like Int32) as integer literals,
// so we preprocess them to unwrap them so Zod understands them.
function unboxNumber(v: unknown): number {
    if (v && typeof v === "object" && typeof v.valueOf === "function") {
        const n = Number(v.valueOf());
        if (!Number.isNaN(n)) return n;
    }
    return v as number;
}

export const zVoyageEmbeddingParameters = z.object({
    outputDimension: z
        .preprocess(
            unboxNumber,
            z.union([z.literal(256), z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)])
        )
        .optional()
        .default(1024),
    outputDtype: z.enum(["float", "int8", "uint8", "binary", "ubinary"]).optional().default("float"),
});

export const zVoyageAPIParameters = zVoyageEmbeddingParameters
    .extend({
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

export const AnyVectorSearchStage = zEJSON();
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
                .describe(
                    "The content to search for. The embeddingParameters field is mandatory if the queryVector is a string, in that case, the tool generates the embedding automatically using the provided configuration."
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
                    "The embedding model and its parameters to use to generate embeddings before searching. It is mandatory if queryVector is a string value. Note to LLM: If unsure, ask the user before providing one."
                ),
        })
        .passthrough(),
});
