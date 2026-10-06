import { z } from "zod";
import type { EvalParameters as BraintrustEvalParameters } from "braintrust";

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ "Parameters" raw zod schema in Eval                                          │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

const ReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

const fields = {
    connectionString: z
        .string()
        .default("mongodb://localhost:27017/?directConnection=true")
        .describe(`MongoDB connection string`),
    model: z.string().default("gpt-5").describe(`Model used by the agent under test`),
    judgeModel: z.string().default("gpt-6-astra").describe(`Model used by the judge`),
    modelReasoningEffort: ReasoningEffortSchema.default("medium").describe(
        `Reasoning effort for the agent under test.`
    ),
    judgeModelReasoningEffort: ReasoningEffortSchema.default("max").describe(`Reasoning effort for the judge.`),
    systemContext: z
        .string()
        .default(
            `You are a MongoDB assistant operating autonomously in a single turn;
the user cannot answer follow-up questions.
Use the available MongoDB MCP tools to fulfill the request end-to-end.
Never ask for clarification; make a reasonable decision and finish the task.
If the request refers to "the collection" without naming it,
discover collections with the list tools and act on the appropriate one
(if there is exactly one user collection, use it).
Prefer tools over guessing, and briefly confirm what you did when done.`
        )
        .describe("System prompt prepended for the agent under test."),
    validateReferenceAnswer: z
        .boolean()
        .default(false)
        .describe(
            `Uses "expected.reference_answer" as the user prompt instead of "input.prompt";
helpful for validating judge criteria against the reference answer.`
        ),
};

export const EvalParametersSchema = z.object(fields).strict();

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ Default Parameter Overrides through BT_EVAL_PARAMS_JSON environment variable │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

const defaults = EvalParametersSchema.parse(JSON.parse(process.env.BT_EVAL_PARAMS_JSON ?? "{}"));

// ╭───────────────────────────────────────────────────────────────────────────────────╮
// │   ↘️ "Parameters" Types in Eval Braintrust format                                 │
// ╰───────────────────────────────────────────────────────────────────────────────────╯

export const EvalParametersBtSchema = {
    connectionString: fields.connectionString.default(defaults.connectionString),
    model: {
        type: "model" as const,
        default: defaults.model,
        description: fields.model.description,
    },
    modelReasoningEffort: fields.modelReasoningEffort.default(defaults.modelReasoningEffort),
    systemContext: fields.systemContext.default(defaults.systemContext),
    judgeModel: {
        type: "model" as const,
        default: defaults.judgeModel,
        description: fields.judgeModel.description,
    },
    judgeModelReasoningEffort: fields.judgeModelReasoningEffort.default(defaults.judgeModelReasoningEffort),
    validateReferenceAnswer: fields.validateReferenceAnswer.default(defaults.validateReferenceAnswer),
} satisfies BraintrustEvalParameters;
