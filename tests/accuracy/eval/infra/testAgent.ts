import { initLogger } from "braintrust";

import type { VercelMCPClientTools } from "../../sdk/agent.js";
import type { Model } from "../../sdk/models.js";
import type { RunEvalInput, Verdict } from "./scaffolding.types.js";
import { Conversation } from "./conversation.js";
import { FollowUpBot } from "./followUpBot.js";
import { JudgeBot } from "./judgeBot.js";

// Module-level side effect: registers the Braintrust logger on first import so all AI SDK calls in this eval run are traced.
initLogger({
    projectName: "MongoDB MCP Server Accuracy Evaluation",
    apiKey: process.env.BRAINTRUST_API_KEY,
});

export interface RunTaskParams {
    model: Model;
    tools: VercelMCPClientTools;
    systemPrompt: string;
    input: RunEvalInput;
    assertions: string | string[];
}

const DEFAULT_MAX_TURNS = 5;

export async function runConversation(params: RunTaskParams): Promise<Verdict> {
    const { model, tools, systemPrompt, input, assertions } = params;
    const maxTurns = input.followUpMaxCount ?? DEFAULT_MAX_TURNS;

    const conversation = new Conversation(tools, model);
    await conversation.converse(systemPrompt, input.userPrompt);

    if (input.followUpInstructions) {
        const followUpBot = new FollowUpBot(model);
        for (let turn = 0; turn < maxTurns; turn++) {
            const result = await followUpBot.decide(conversation, input.followUpInstructions);
            if (!result.hasFollowUp) break;
            await conversation.converse(systemPrompt, result.response);
        }
    }

    const judgeBot = new JudgeBot(model, tools);
    return judgeBot.score(conversation, assertions);
}
