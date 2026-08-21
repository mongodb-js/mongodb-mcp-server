import { z } from "zod";
import type { EvalScorerArgs } from "braintrust";
import { GetResponseTool } from "./tool/getResponse.js";
import { GetConversationTool } from "./tool/getConversation.js";
import { GetReferenceAnswerTool } from "./tool/getReferenceAnswer.js";

// ╭──────────────────────────────────────────────╮
// │   ↘️ "Input" Types in Eval                   │
// ╰──────────────────────────────────────────────╯

/** Atlas Search / Vector Search index to create on a seeded collection. */
export const SeedSearchIndexSchema = z
    .object({
        type: z
            .enum(["search", "vectorSearch"])
            .describe("Index kind: 'search' for Atlas Search, 'vectorSearch' for vector search."),
        name: z
            .string()
            .describe(
                "Unique name of the search index. It is not optional because it is used to await readiness before querying."
            ),
        definition: z
            .record(z.string(), z.unknown())
            .describe(
                "Raw Atlas search index definition.\n\nFor more details, see the MongoDB Atlas Search documentation: https://www.mongodb.com/docs/manual/reference/command/createSearchIndexes/"
            ),
    })
    .describe("An Atlas Search or Vector Search index to build on the collection.");

/** Classic (b-tree) MongoDB index to create on a seeded collection. */
export const SeedClassicIndexSchema = z
    .object({
        type: z.literal("classic").describe("Marks this as a classic (non-search) MongoDB index."),
        name: z.string().optional().describe("Optional index name; MongoDB auto-generates one when omitted."),
        key: z
            .record(z.string(), z.union([z.literal(1), z.literal(-1)]))
            .describe("Index key spec mapping field name to sort order (1 ascending, -1 descending)."),
    })
    // Allow extra createIndex options (unique, sparse, partialFilterExpression, …).
    .catchall(z.unknown())
    .describe("A classic MongoDB index, plus any additional createIndex options.");

/** Either a search/vector index or a classic index. */
export const SeedIndexSpecSchema = z
    .discriminatedUnion("type", [SeedSearchIndexSchema, SeedClassicIndexSchema])
    .describe("A single index to create on a seeded collection, discriminated by 'type'.");

/** Per-collection seeding configuration. */
export const SeedSetupSchema = z
    .object({
        indexes: z.array(SeedIndexSpecSchema).optional().describe("Indexes to create after documents are inserted."),
    })
    .describe("Setup applied to a seeded collection (currently just its indexes).");

/**
 * One database seed entry: either a bare collection name (documents only), or a
 * single-key object mapping the collection name to its setup (indexes, …).
 */
export const DbSeedEntrySchema = z
    .union([
        z.string().describe("Bare collection name to seed with its bundled documents and no indexes."),
        z
            .record(z.string(), SeedSetupSchema)
            .describe("Single-key object mapping a collection name to its seeding setup."),
    ])
    .describe("A collection to seed, optionally with index setup.");

/** Eval `input`: the user prompt plus optional database seeding. */
export const RunEvalInputSchema = z
    .object({
        prompt: z.string().describe("The natural-language task sent to the agent for this case."),
        db_seed: z
            .array(DbSeedEntrySchema)
            .optional()
            .describe("Collections to seed into a fresh temp database before the agent runs."),
    })
    .describe("Input for a single MongoDB agent eval case.");

// ╭──────────────────────────────────────────────╮
// │   ↘️ "Expected" Types in Eval                │
// ╰──────────────────────────────────────────────╯

/** Eval `expected`: the criteria the LLM judge grades the answer against. */
export const RunEvalExpectedSchema = z
    .object({
        llm_judge: z.string().optional()
            .describe(`Provide a prompt for the LLM judge to evaluate and make assertions about:
- the state of the database after the assistant completes the prompt. The judge may use any available read-only MCP tools to check and validate these assertions.
- if prompt references ${GetResponseTool.keyword}, the assistant's response for this eval case will be made available for evaluation.
- if prompt references ${GetConversationTool.keyword}, the full conversation history, including tool calls and tool results for this eval case, will be accessible for evaluation.
- if prompt references ${GetReferenceAnswerTool.keyword}, the reference answer as specified in the "expected.reference_answer" field will be made available for evaluation.
`),
        reference_answer: z
            .string()
            .optional()
            .describe(
                `The reference answer for the eval case. This provides human reviewers with a clear example of the expected answer.
                If the LLM judge prompt references ${GetReferenceAnswerTool.keyword}, this value will be made available to the judge for automated evaluation.`
            ),
    })
    .describe("Expected outcome for a case, expressed as LLM-judge criteria.");

// ╭──────────────────────────────────────────────╮
// │   ↘️ "Metadata" Types in Eval                │
// ╰──────────────────────────────────────────────╯

export const RunEvalMetadataSchema = z
    .object({
        name: z.string().describe("A short, descriptive name for this eval case."),
        description: z.string().describe("A brief summary explaining what this eval case tests."),
        category: z.string().optional().describe("The primary (level 1) taxonomy category for this eval case."),
        subcategory: z.string().optional().describe("The secondary (level 2) taxonomy subcategory for this eval case."),
        group: z.string().optional().describe("Level 3 taxonomy group for this eval case."),
        subGroup: z.string().optional().describe("Level 4 taxonomy subgroup for this eval case."),
    })
    .describe("Metadata for a single MongoDB agent eval case.");

// ╭──────────────────────────────────────────────╮
// │   ↘️ "Output" Types in Eval                 │
// ╰──────────────────────────────────────────────╯

/** A single LLM-judge decision. */
export const VerdictSchema = z
    .object({
        score: z.number().describe("Judge score in [0, 1], where 1 means all criteria were fully met."),
        explanation: z.string().describe("Short natural-language justification for the score."),
    })
    .describe("The LLM judge's score and reasoning for a case.");

/** Eval `output`: what the task produced for a case. */
export const RunEvalOutputSchema = z
    .object({
        response: z.string().describe("Final assistant message text produced by the agent."),
        judge: VerdictSchema.optional().describe("The judge verdict, attached after scoring runs."),
    })
    .describe("Output of a single MongoDB agent eval case.");

// ╭──────────────────────────────────────────────╮
// │   ↘️ Inferred Types                          │
// ╰──────────────────────────────────────────────╯

export type SeedClassicIndex = z.infer<typeof SeedClassicIndexSchema>;
export type SeedIndexSpec = z.infer<typeof SeedIndexSpecSchema>;
export type DbSeedEntry = z.infer<typeof DbSeedEntrySchema>;
export type RunEvalInput = z.infer<typeof RunEvalInputSchema>;
export type RunEvalExpected = z.infer<typeof RunEvalExpectedSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type RunEvalOutput = z.infer<typeof RunEvalOutputSchema>;

// ╭──────────────────────────────────────────────╮
// │   ↘️ "Scorer Args" Types in Eval             │
// ╰──────────────────────────────────────────────╯

export type RunEvalScorerArgs = EvalScorerArgs<RunEvalInput, RunEvalOutput, RunEvalExpected>;
