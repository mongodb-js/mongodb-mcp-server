import { Eval, Reporter, reportFailures, type EvalParameters } from "braintrust";
import { getRandomValues } from "node:crypto";
import { z } from "zod";
import * as shared from "./lib/shared.js";
import { llmJudgeScore } from "./lib/scoring.js";
import { judgeUsingLLM } from "./lib/judge.js";
import { runTask } from "./lib/user.js";
import { seedTempDb } from "./lib/seeding.js";
import type { RunEvalExpected, RunEvalInput, RunEvalOutput } from "./lib/datasetTypes.js";
import { GetConversationTool } from "./lib/tool/getConversation.js";
import { GetResponseTool } from "./lib/tool/getResponse.js";
import { initDataset } from "braintrust";
import { GetReferenceAnswerTool } from "./lib/tool/getReferenceAnswer.js";

const PROJECT_NAME = "mongodb-mcp-server-evals";
const DATASET_NAME = "Search";
const AGENT_STEP_LIMIT = 10;
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_JUDGE_MODEL = "us.anthropic.claude-sonnet-4-6";
const DEFAULT_CONNECTION_STRING = "mongodb://localhost:27017/?directConnection=true";

const DEFAULT_SYSTEM_CONTEXT =
    'You are a MongoDB assistant operating autonomously in a single turn; the user cannot answer follow-up questions. Use the available MongoDB MCP tools to fulfill the request end-to-end. Never ask for clarification; make a reasonable decision and finish the task. If the request refers to "the collection" without naming it, discover collections with the list tools and act on the appropriate one (if there is exactly one user collection, use it). Prefer tools over guessing, and briefly confirm what you did when done.';

const parameters = {
    connectionString: z.string().default(DEFAULT_CONNECTION_STRING).describe("MongoDB connection string."),
    model: {
        type: "model" as const,
        default: DEFAULT_MODEL,
        description: "Model used by the agent under test.",
    },
    judgeModel: {
        type: "model" as const,
        default: DEFAULT_JUDGE_MODEL,
        description: "Model used by the judge.",
    },
    systemContext: z
        .string()
        .default(DEFAULT_SYSTEM_CONTEXT)
        .describe("System prompt prepended for the agent under test."),
} as unknown as EvalParameters;

type ResolvedParameters = {
    connectionString: string;
    model: string;
    judgeModel: string;
    systemContext: string;
};

function parseEnvParams(): Record<string, unknown> {
    const raw = process.env.BT_EVAL_PARAMS_JSON;
    if (!raw) return {};
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
        console.warn("Failed to parse BT_EVAL_PARAMS_JSON:", error);
        return {};
    }
}

function stringParam(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Ensures parameter resolution works across all eval modes:
 * - Braintrust CLI ('bt'): supports 'BT_EVAL_PARAMS_JSON'
 * - Braintrust script ('braintrust') and tsx: do not support 'BT_EVAL_PARAMS_JSON'
 * Always resolve parameters so eval runs correctly regardless of entry point.
 */
function resolveParameters(hooksParameters: Record<string, unknown>): ResolvedParameters {
    const envParams = parseEnvParams();
    const connectionString = stringParam(
        hooksParameters.connectionString ?? envParams.connectionString ?? process.env.EVAL_CONNECTION_STRING,
        DEFAULT_CONNECTION_STRING
    );
    const model = stringParam(hooksParameters.model ?? envParams.model, DEFAULT_MODEL);
    const judgeModel = stringParam(hooksParameters.judgeModel ?? envParams.judgeModel, DEFAULT_JUDGE_MODEL);
    const systemContext = stringParam(hooksParameters.systemContext ?? envParams.systemContext, DEFAULT_SYSTEM_CONTEXT);

    return { connectionString, model, judgeModel, systemContext };
}

/**
 * Generates a unique but shorter name for the transient database.
 *
 * @returns The transient database name in the format of 'eval_<YYYY-MM-dd>_<HH-mm-ss>_<random>' (e.g. 'eval__2026-01-02_03-04-05__9a1e23').
 */
function transientDbName(): string {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    const random = Buffer.from(getRandomValues(new Uint8Array(4))).toString("hex");
    return `eval_${time}_${random}`;
}

const reporter = Reporter<boolean>("mongodb-eval-cleanup", {
    async reportEval(evaluator, result, opts) {
        const { results, summary } = result;
        const failing = results.filter((r) => r.error !== undefined);
        reportFailures(evaluator, failing, opts);

        const scores = Object.entries(summary.scores ?? {})
            .map(([name, s]) => `${name}=${(s.score * 100).toFixed(2)}%`)
            .join(" ");
        console.log(`[eval] ${summary.experimentName ?? PROJECT_NAME} ${scores}`);

        await shared.teardown();
        return failing.length === 0;
    },
    reportRun(reports) {
        return reports.every((ok) => ok);
    },
});

void Eval<RunEvalInput, RunEvalOutput, RunEvalExpected, void, boolean, EvalParameters>(
    PROJECT_NAME,
    {
        data: initDataset(PROJECT_NAME, {
            dataset: DATASET_NAME,
        }),
        task: async (input, hooks) => {
            const aiProvider = await shared.getAiProvider();
            const resolved = resolveParameters(hooks.parameters as Record<string, unknown>);
            shared.registerConnectionString(resolved.connectionString);

            const model = aiProvider.chat(resolved.model);
            const judgeModel = aiProvider.chat(resolved.judgeModel);

            const dbName = transientDbName();
            shared.registerTempDb(dbName);
            const dbClient = await shared.getMongoDbClient();

            try {
                await hooks.span.traced(() => seedTempDb(dbClient, dbName, input.db_seed), { name: "seedTempDb" });
                const mcpClient = await hooks.span.traced(() => shared.getMcpClient(), {
                    name: "getMcpClient",
                });

                const tools = await mcpClient.tools();

                const { response, messages } = await runTask({
                    model,
                    systemContext: resolved.systemContext,
                    tools,
                    prompt: input.prompt,
                    tempDbName: dbName,
                    stepLimit: AGENT_STEP_LIMIT,
                });

                let judge: RunEvalOutput["judge"];
                const criteria = hooks.expected?.llm_judge;
                if (criteria) {
                    const readOnlyMcpClient = await hooks.span.traced(() => shared.getReadOnlyMcpClient(), {
                        name: "getReadOnlyMcpClient",
                    });
                    const readOnlyTools = await readOnlyMcpClient.tools();

                    judge = await judgeUsingLLM({
                        model: judgeModel,
                        tools: {
                            ...readOnlyTools,
                            [GetConversationTool.toolName]: new GetConversationTool(messages).getTool(),
                            [GetResponseTool.toolName]: new GetResponseTool(response).getTool(),
                            [GetReferenceAnswerTool.toolName]: new GetReferenceAnswerTool(
                                hooks.expected?.reference_answer ?? "<no reference answer provided>"
                            ).getTool(),
                        },
                        criteria,
                        tempDbName: dbName,
                    });
                }

                return { response, judge };
            } finally {
                await hooks.span.traced(() => shared.dropCaseDb(dbName), { name: "dropTempDb" });
            }
        },
        scores: [llmJudgeScore],
        baseExperimentName: process.env.EVAL_BASE_EXPERIMENT_NAME,
        parameters,
    },
    reporter
);
