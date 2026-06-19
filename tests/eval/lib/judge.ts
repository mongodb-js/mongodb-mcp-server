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
    explanation: `Judge did not submit a score before the step limit (${DEFAULT_STEP_COUNT}).`,
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
    criteria: string | string[];
}): Promise<Verdict> {
    const { model, tools, criteria, tempDbName } = params;
    const submitScoreTool = new SubmitScoreTool();

    await traced(
        async () => {
            await ai.generateText({
                model,
                system: composeJudgeSystemPrompt(criteria, tempDbName),
                messages: [
                    {
                        role: "user" as const,
                        content: `Verify the criteria, then call ${SubmitScoreTool.toolName} exactly once.`,
                    },
                ],
                tools: {
                    ...tools,
                    [SubmitScoreTool.toolName]: submitScoreTool.getTool(),
                },
                stopWhen: [
                    untracedAi.stepCountIs(DEFAULT_STEP_COUNT),
                    untracedAi.hasToolCall(SubmitScoreTool.toolName),
                ],
            });
        },
        { name: "llm-judge" }
    );

    return submitScoreTool.getCapturedVerdict() ?? FALLBACK;
}

function composeJudgeSystemPrompt(criteria: string | string[], tempDbName: string): string {
    const list = Array.isArray(criteria) ? criteria : [criteria];
    return [
        "You are evaluating a MongoDB AI assistant on behalf of a human tester.",
        "Decide whether the criteria below are satisfied and produce a score from 0 to 1.",
        "",
        "### Rules of Engagement",
        `- You MUST conclude the iteration by passing your results to the ${SubmitScoreTool.toolName} tool.`,
        "",
        "### Criteria",
        ...list.map((c, i) => `${i + 1}. ${c}`),
        "",
        "### Tools",
        `- Use the MCP tools to inspect the current database state. Operate ONLY on the database named '${tempDbName}'.`,
        `- If a criterion references ${GetConversationTool.keyword}, call ${GetConversationTool.toolName} to read the assistant's transcript.`,
        `- If a criterion references ${GetResponseTool.keyword}, call ${GetResponseTool.toolName} to read the assistant's final response.`,
        "",
        "### Scoring",
        "- 1.0 = every criterion fully satisfied; partial credit proportional to how many are satisfied; 0.0 = none.",
    ].join("\n");
}
