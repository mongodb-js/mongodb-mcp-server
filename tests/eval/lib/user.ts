import * as untracedAi from "ai";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import { wrapAISDK } from "braintrust";

const { generateText } = wrapAISDK(untracedAi);

const DEFAULT_STEP_LIMIT = 10;

/**
 * Runs the single-turn prompt against the LLM model integrated with the MCP tools.
 *
 * @param params - The parameters for the task run.
 * @param params.model - The model powering the task under test.
 * @param params.systemContext - The base system prompt for the task under test.
 * @param params.tools - The MCP tools exposed to the task.
 * @param params.prompt - The user prompt (the task) for this case.
 * @param params.tempDbName - The temporary database the task must operate on.
 * @param params.stepLimit - The maximum number of task steps before stopping.
 * @returns The task's final response text and the full conversation transcript.
 */
export async function runTask(params: {
    model: LanguageModel;
    systemContext: string;
    tools: ToolSet;
    prompt: string;
    tempDbName: string;
    stepLimit?: number;
}): Promise<{ response: string; messages: ModelMessage[] }> {
    const { model, systemContext, tools, prompt, tempDbName, stepLimit = DEFAULT_STEP_LIMIT } = params;

    const system = `${systemContext}
    
    All operations must target the MongoDB database named "${tempDbName}".
    Always pass this database name to any tool that accepts a database argument, and never use any other database.`;
    const userMessage = { role: "user" as const, content: prompt };

    const response = await generateText({
        model,
        system,
        messages: [userMessage],
        tools,
        stopWhen: untracedAi.stepCountIs(stepLimit),
    });

    return {
        response: response.text,
        messages: [userMessage, ...(response.response.messages as ModelMessage[])],
    };
}
