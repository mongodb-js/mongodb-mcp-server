import { generateText, Tool, Schema, LanguageModelV1 } from "ai";
import { Model } from "./models.js";

const systemPrompt = [
    'The keywords "MUST", "MUST NOT", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119',
    "You are an expert AI assistant with access to a set of tools for MongoDB database operations.",
    "You MUST use the most relevant tool to answer the user's request",
    "When calling a tool, you MUST strictly follow its input schema and MUST provide all required arguments",
    "If a task requires multiple steps, you MUST call the necessary tools in sequence",
    'If you do not know the answer or the request cannot be fulfilled, you MUST reply with "I don\'t know"',
    "You SHOULD assume that you are already connected to a MongoDB connection",
].join("\n");

export interface Agent<M = unknown, T = unknown, R = unknown> {
    prompt(prompt: string, model: M, tools: T): Promise<R>;
}

export function getVercelToolCallingAgent(): Agent<
    Model<LanguageModelV1>,
    Record<string, Tool<Schema<unknown>>>,
    { text: string; messages: unknown[] }
> {
    return {
        async prompt(prompt: string, model: Model<LanguageModelV1>, tools: Record<string, Tool<Schema<unknown>>>) {
            const result = await generateText({
                model: model.getModel(),
                system: systemPrompt,
                prompt,
                tools,
                maxSteps: 100,
            });
            return {
                text: result.text,
                messages: result.response.messages,
            };
        },
    };
}
