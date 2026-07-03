// Note: Braintrust API uses zod v3. If we use zod v4 here, it causes type errors; while those errors can be suppressed, we've chosen to avoid that and use zod v3 for better type safety.
import { z as z3 } from "zod/v3";
import type { EvalParameters as BraintrustEvalParameters } from "braintrust";

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ "Parameters" raw zod schema in Eval                                          │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

export const EvalParametersSchema = z3
    .object({
        connectionString: z3
            .string()
            .describe(`MongoDB connection string`)
            .default("mongodb://localhost:27017/?directConnection=true"),
        model: z3.string().describe(`Model used by the agent under test`).default("gpt-5"),
        judgeModel: z3.string().describe(`Model used by the judge`).default("us.anthropic.claude-sonnet-4-6"),
        systemContext: z3
            .string()
            .describe("System prompt prepended for the agent under test.")
            .default(
                `You are a MongoDB assistant operating autonomously in a single turn;
the user cannot answer follow-up questions.
Use the available MongoDB MCP tools to fulfill the request end-to-end.
Never ask for clarification; make a reasonable decision and finish the task.
If the request refers to "the collection" without naming it,
discover collections with the list tools and act on the appropriate one
(if there is exactly one user collection, use it).
Prefer tools over guessing, and briefly confirm what you did when done.`
            ),
        validateReferenceAnswer: z3
            .boolean()
            .describe(
                `Uses "expected.reference_answer" as the user prompt instead of "input.prompt";
helpful for validating judge criteria against the reference answer.`
            )
            .default(false),
    })
    .strict();

export type EvalParameters = z3.infer<typeof EvalParametersSchema>;

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ Default Parameter Overrides through BT_EVAL_PARAMS_JSON environment variable │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

const defaults = EvalParametersSchema.parse(JSON.parse(process.env.BT_EVAL_PARAMS_JSON ?? "{}"));

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ "Parameters" Types in Eval Braintrust format                                 │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

export const EvalParametersBtSchema = {
    connectionString: z3
        .string()
        .default(defaults.connectionString)
        .describe(EvalParametersSchema.shape.connectionString.description!),
    model: {
        type: "model" as const,
        default: defaults.model,
        description: EvalParametersSchema.shape.model.description!,
    },
    systemContext: z3
        .string()
        .default(defaults.systemContext)
        .describe(EvalParametersSchema.shape.systemContext.description!),
    judgeModel: {
        type: "model" as const,
        default: defaults.judgeModel,
        description: EvalParametersSchema.shape.judgeModel.description!,
    },
    validateReferenceAnswer: z3
        .boolean()
        .default(defaults.validateReferenceAnswer)
        .describe(EvalParametersSchema.shape.validateReferenceAnswer.description!),
} satisfies BraintrustEvalParameters;
