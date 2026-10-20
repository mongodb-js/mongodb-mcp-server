import * as untracedAi from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { wrapAISDK } from "braintrust";
import { RunEvalInputSchema } from "./datasetTypes.js";

const { generateText } = wrapAISDK(untracedAi);

const DEFAULT_STEP_LIMIT = 10;

/**
 * Runs a prompt and optional scripted follow-ups against the LLM model integrated with the MCP tools.
 *
 * @param params - The parameters for the task run.
 * @param params.model - The model powering the task under test.
 * @param params.systemContext - The base system prompt for the task under test.
 * @param params.tools - The MCP tools exposed to the task.
 * @param params.prompt - The user prompt (the task) for this case.
 * @param params.followUpPrompts - Scripted user replies, sent after each completed agent turn.
 * @param params.tempDbName - The temporary database the task must operate on.
 * @param params.stepLimit - The maximum number of task steps across all turns before stopping.
 * @returns The task's final response text and the full conversation transcript.
 */
export async function runTask(params: {
    model: LanguageModel;
    systemContext: string;
    tools: ToolSet;
    prompt: string;
    followUpPrompts?: string[];
    tempDbName: string;
    stepLimit?: number;
}): Promise<{ response: string; messages: ModelMessage[] }> {
    const { model, systemContext, tools, prompt, tempDbName, stepLimit = DEFAULT_STEP_LIMIT } = params;
    const followUpPrompts = RunEvalInputSchema.shape.follow_up_prompts.parse(params.followUpPrompts) ?? [];
    if (!Number.isSafeInteger(stepLimit) || stepLimit < 1) {
        throw new Error("stepLimit must be a positive safe integer");
    }

    const conversationContext =
        followUpPrompts.length > 0
            ? `

    This case is a scripted multi-turn conversation. Single-turn-only and no-clarification instructions above do not apply.
    You may ask for clarification when needed and wait for the next user message.
    Respond only to messages already in the conversation; never invent user replies.`
            : "";
    const system = `${systemContext}${conversationContext}
    
    All operations must target the MongoDB database named "${tempDbName}".
    Always pass this database name to any tool that accepts a database argument, and never use any other database.`;
    const messages: ModelMessage[] = [];
    let remainingSteps = stepLimit;
    let finalResponse = "";

    for (const turnPrompt of [prompt, ...followUpPrompts]) {
        if (remainingSteps < 1) {
            throw new Error(
                `The LLM model exhausted the task step limit [${stepLimit}] before all scripted user turns were processed.`
            );
        }

        messages.push({ role: "user", content: turnPrompt });
        const response = await generateText({
            model,
            system,
            messages: [...messages],
            tools,
            stopWhen: untracedAi.stepCountIs(remainingSteps),
        });
        messages.push(...response.response.messages);
        remainingSteps -= response.steps.length;

        if (response.finishReason !== "stop") {
            return {
                response: `The LLM model was stopped unexpectedly because of [${response.finishReason}] ${response.rawFinishReason}.\n${response.text}`,
                messages,
            };
        }
        finalResponse = response.text;
    }

    return {
        response: finalResponse,
        messages,
    };
}
