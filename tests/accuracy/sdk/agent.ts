import { generateText, LanguageModelV1, experimental_createMCPClient } from "ai";
import { Model } from "./models.js";

const systemPrompt = [
    'The keywords "MUST", "MUST NOT", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119',
    "You are an expert AI assistant with access to a set of tools for MongoDB database operations.",
    "You MUST use the most relevant tool to answer the user's request",
    "When calling a tool, you MUST strictly follow its input schema and MUST provide all required arguments",
    "If a task requires multiple tool calls, you MUST call all the necessary tools in sequence, following the requirements mentioned above for each tool called.",
    'If you do not know the answer or the request cannot be fulfilled, you MUST reply with "I don\'t know"',
];

// These types are not exported by Vercel SDK so we derive them here to be
// re-used again.
export type VercelMCPClient = Awaited<ReturnType<typeof experimental_createMCPClient>>;
export type VercelMCPClientTools = Awaited<ReturnType<VercelMCPClient["tools"]>>;
export type VercelAgent = ReturnType<typeof getVercelToolCallingAgent>;

export interface VercelAgentPromptResult {
    respondingModel: string;
    tokensUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    text: string;
    messages: Record<string, unknown>[];
}

// Generic interface for Agent, in case we need to switch to some other agent
// development SDK
export interface Agent<Model = unknown, Tools = unknown, Result = unknown> {
    prompt(prompt: string, model: Model, tools: Tools): Promise<Result>;
}

export function getVercelToolCallingAgent(
    requestedSystemPrompt?: string
): Agent<Model<LanguageModelV1>, VercelMCPClientTools, VercelAgentPromptResult> {
    return {
        async prompt(
            prompt: string,
            model: Model<LanguageModelV1>,
            tools: VercelMCPClientTools
        ): Promise<VercelAgentPromptResult> {
            const result = await generateText({
                model: model.getModel(),
                system: [...systemPrompt, requestedSystemPrompt].filter(Boolean).join("\n"),
                prompt,
                tools,
                maxSteps: 100,
            });
            return {
                text: result.text,
                messages: result.response.messages,
                respondingModel: result.response.modelId,
                tokensUsage: result.usage,
            };
        },
    };
}
