import * as untracedAi from "ai";
import type { LanguageModel, ToolSet } from "ai";
import { wrapAISDK, traced } from "braintrust";
import type { Verdict } from "./datasetTypes.js";
import { SubmitScoreTool } from "./tool/submitScore.js";
import { GetConversationTool } from "./tool/getConversation.js";
import { GetResponseTool } from "./tool/getResponse.js";

const ai = wrapAISDK(untracedAi);

const DEFAULT_STEP_COUNT = 10;

const FALLBACK: Verdict = {
    score: 0,
    explanation: `Judge finished without submitting a score (step limit ${DEFAULT_STEP_COUNT}).`,
};

/**
 * Judges the assistant's response against the criteria.
 *
 * @param params - The parameters for the judge.
 * @param params.model - The model to use for the judge.
 * @param params.tools - The MCP tools to be exposed to the judge.
 * @param params.criteria - The criteria the LLM judge should evaluate.
 * @param params.tempDbName - The name of the temporary database the LLM judge should operate on.
 * @returns The verdict.
 */
export async function judgeUsingLLM(params: {
    model: LanguageModel;
    tools: ToolSet;
    tempDbName: string;
    criteria: string;
}): Promise<Verdict> {
    const { model, tools, criteria, tempDbName } = params;
    const submitScoreTool = new SubmitScoreTool();

    const judgeTools: ToolSet = {
        ...tools,
        [SubmitScoreTool.toolName]: submitScoreTool.getTool(),
    };
    const system = composeJudgeSystemPrompt(tempDbName);
    const messages: untracedAi.ModelMessage[] = [
        {
            role: "user",
            content: `Verify the following criteria:\n${criteria}`,
        },
    ];

    await traced(
        async () => {
            const result = await ai.generateText({
                model,
                system,
                messages,
                tools: judgeTools,
                stopWhen: [
                    untracedAi.stepCountIs(DEFAULT_STEP_COUNT),
                    untracedAi.hasToolCall(SubmitScoreTool.toolName),
                ],
            });

            // The judge may end its turn with a plain-text verdict instead of calling submit_score (text responses stop
            // generateText naturally, independent of stopWhen). If that happens, re-prompt once and
            // force the submit_score call so a verdict is always captured.
            if (submitScoreTool.getCapturedVerdict() === undefined) {
                await ai.generateText({
                    model,
                    system,
                    messages: [
                        ...messages,
                        ...result.response.messages,
                        {
                            role: "user",
                            content: `You did not call ${SubmitScoreTool.toolName}. Call it now exactly once with your final score.`,
                        },
                    ],
                    tools: judgeTools,
                    toolChoice: { type: "tool", toolName: SubmitScoreTool.toolName },
                    stopWhen: untracedAi.stepCountIs(1),
                });
            }
        },
        { name: "llm-judge" }
    );

    return submitScoreTool.getCapturedVerdict() ?? FALLBACK;
}

function composeJudgeSystemPrompt(tempDbName: string): string {
    return [
        "You are evaluating a MongoDB AI assistant on behalf of a human tester.",
        "Decide whether the provided criteria are satisfied and produce a score from 0 to 1.",
        "",
        "### Rules of Engagement",
        `- You MUST conclude the iteration by passing your results to the ${SubmitScoreTool.toolName} tool exactly once.`,
        "",
        "### Tools",
        `- Use the MCP tools to inspect the current database state. Operate ONLY on the database named '${tempDbName}'.`,
        `- If a criterion references ${GetConversationTool.keyword}, call ${GetConversationTool.toolName} to read the assistant's transcript.`,
        `- If a criterion references ${GetResponseTool.keyword}, call ${GetResponseTool.toolName} to read the assistant's final response.`,
        "",
        "### Scoring",
        "If no scoring criteria are provided, score the assistant's response based on the following criteria:",
        "- 1.0 = every criterion fully satisfied; partial credit proportional to how many are satisfied.",
        "- 0.0 = none.",
    ].join("\n");
}
