import { Eval, Reporter, reportFailures } from "braintrust";
import { getRandomValues } from "node:crypto";
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
import { EvalParametersBtSchema } from "./lib/evalTypes.js";

const PROJECT_NAME = "mongodb-mcp-server-evals";
const DATASET_NAME = "Search";
const AGENT_STEP_LIMIT = 10;

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

void Eval<RunEvalInput, RunEvalOutput, RunEvalExpected, void, boolean, typeof EvalParametersBtSchema>(
    PROJECT_NAME,
    {
        data: initDataset(PROJECT_NAME, {
            dataset: DATASET_NAME,
        }),
        task: async (input, hooks) => {
            const aiProvider = await shared.getAiProvider();
            const resolved = hooks.parameters;
            shared.registerConnectionString(resolved.connectionString);

            const model = aiProvider.chat(resolved.model);
            const judgeModel = aiProvider.chat(resolved.judgeModel);

            const dbName = transientDbName();
            shared.registerTempDb(dbName);
            const dbClient = await shared.getMongoDbClient();

            try {
                await hooks.span.traced(() => seedTempDb(dbClient, dbName, input.db_seed), { name: "seedTempDb" });
                const mcpClient = await hooks.span.traced(shared.getMcpClient, { name: "getMcpClient" });

                const tools = await mcpClient.tools();

                let prompt: string;
                if (resolved.validateReferenceAnswer) {
                    if (!hooks.expected?.reference_answer) {
                        throw new Error("No reference answer provided in the eval case");
                    }
                    prompt = `Execute the following reference answer:

\`\`\`
${hooks.expected.reference_answer}
\`\`\``;
                } else {
                    prompt = input.prompt;
                }

                const { response, messages } = await runTask({
                    model,
                    systemContext: resolved.systemContext,
                    tools,
                    prompt,
                    tempDbName: dbName,
                    stepLimit: AGENT_STEP_LIMIT,
                });

                let judge: RunEvalOutput["judge"];
                const criteria = hooks.expected?.llm_judge;
                if (criteria) {
                    const readOnlyMcpClient = await hooks.span.traced(shared.getReadOnlyMcpClient, {
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
        parameters: EvalParametersBtSchema,
        maxConcurrency: process.env.EVAL_MAX_CONCURRENCY ? parseInt(process.env.EVAL_MAX_CONCURRENCY) : undefined,
        metadata: {
            git_branch_name: process.env.GIT_BRANCH_NAME,
        },
    },
    reporter
);
