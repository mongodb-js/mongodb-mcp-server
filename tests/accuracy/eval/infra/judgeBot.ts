import * as untracedAi from "ai";
import { wrapAISDK, traced } from "braintrust";
import { z } from "zod";

import type { VercelMCPClientTools } from "../../sdk/agent.js";
import type { Model } from "../../sdk/models.js";
import type { Verdict } from "./scaffolding.types.js";
import { type Conversation, ROLE, serializeMessages, debugStep } from "./conversation.js";

const ai = wrapAISDK(untracedAi);

// Number of LLM steps (tool calls, tool results, and assistant messages) allowed
// per conversation before forcefully stopping it to prevent infinite loops in failure cases.
const DEFAULT_STEP_COUNT = 10;

// Read-only tools only — prevents the judge from mutating test state while verifying assertions.
const ALLOWED_TOOLS = new Set([
    "list-collections",
    "find",
    "aggregate",
    "count",
    "collection-schema",
    "collection-indexes",
]);

const scoreSchema = z.object({
    score: z.number().min(0).max(1).describe("0.0 = no assertion satisfied, 1.0 = all fully satisfied"),
    explanation: z.string().describe("brief explanation of the score"),
});

export class JudgeBot {
    private filteredTools: VercelMCPClientTools;

    constructor(
        private model: Model,
        tools: VercelMCPClientTools
    ) {
        this.filteredTools = Object.fromEntries(
            Object.entries(tools).filter(([name]) => ALLOWED_TOOLS.has(name))
        ) as VercelMCPClientTools;
    }

    async score(conversation: Conversation, assertions: string | string[]): Promise<Verdict> {
        const conversationSummary = serializeMessages(conversation.getMessages());

        // We capture structured data via tool calls rather than forcing schema on text generation,
        // which preserves the model's reasoning for debugging.
        let scoreResult: z.infer<typeof scoreSchema> = {
            score: 0,
            explanation: "Judge did not submit a score before step limit"
        };
        const submitScoreTool = untracedAi.tool({
            description: "Submit your final score. Call this exactly once when ready.",
            inputSchema: scoreSchema,
            execute: async (input) => {
                scoreResult = input;
                return { ok: true };
            },
        });

        await traced(
            async () => {
                const prompt = `Process this conversation:\n${conversationSummary}`;
                debugStep(`${ROLE.USER}[${ROLE.JUDGE_BOT}]`, { stepNumber: 0, text: prompt } as any);

                await ai.generateText({
                    model: this.model.getModel(),
                    system: buildScorerSystemPrompt(assertions),
                    messages: [{ role: "user" as const, content: prompt }],
                    tools: {
                        ...this.filteredTools,
                        "submit-score": submitScoreTool,
                    },
                    onStepFinish: (step) => debugStep(`${ROLE.ASSISTANT}[${ROLE.JUDGE_BOT}]`, step),
                    stopWhen: [
                        ai.stepCountIs(DEFAULT_STEP_COUNT),
                        ai.hasToolCall("submit-score"),
                    ],
                });
            },
            { name: "judge-bot" }
        );
        
        return scoreResult;
    }
}

function buildScorerSystemPrompt(assertions: string[] | string): string {
    const assertionsArray = Array.isArray(assertions) ? assertions : [assertions];

    return [
        "You are a test-driver agent evaluating a MongoDB AI assistant on behalf of a human tester.",
        "You receive a conversation transcript (including tool calls and results) and a list of assertions to verify.",
        "",
        "### Assertions",
        ...assertionsArray.map((s, i) => `${i + 1}. ${s}`),
        "",
        "### Scoring guide",
        "- 1.0 = every assertion fully satisfied",
        "- Partial credit proportional to how many assertions are satisfied",
        "- 0.0 = none satisfied",
        "",
        "### Behaviour",
        "- Use MCP tools to inspect the current database state and verify the assertions.",
        "- Call `submit-score` exactly once with a score and explanation. Do not stop without calling it.",
    ].join("\n");
}
