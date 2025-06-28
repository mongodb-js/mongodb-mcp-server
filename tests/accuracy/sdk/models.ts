import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ToolResultForOllama = string;
export type AcceptableToolResponse = CallToolResult | ToolResultForOllama;

export interface Model<M extends BaseChatModel = BaseChatModel, T extends AcceptableToolResponse = CallToolResult> {
    isAvailable(): boolean;
    getLangChainModel(): M;
    transformToolResult(callToolResult: CallToolResult): T;
}

export class GeminiModel implements Model<ChatGoogleGenerativeAI> {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return !!process.env.MDB_GEMINI_API_KEY;
    }

    getLangChainModel(): ChatGoogleGenerativeAI {
        return new ChatGoogleGenerativeAI({
            model: this.modelName,
            apiKey: process.env.MDB_GEMINI_API_KEY,
        });
    }

    transformToolResult(callToolResult: CallToolResult) {
        return callToolResult;
    }
}

export class OllamaModel implements Model<ChatOllama, ToolResultForOllama> {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return !!process.env.MDB_GEMINI_API_KEY;
    }

    getLangChainModel(): ChatOllama {
        return new ChatOllama({
            model: this.modelName,
        });
    }

    transformToolResult(callToolResult: CallToolResult): ToolResultForOllama {
        return JSON.stringify(callToolResult);
    }
}

const ALL_TESTABLE_MODELS = [
    // new GeminiModel("gemini-1.5-flash"),
    // new GeminiModel("gemini-2.0-flash"),
    new OllamaModel("qwen3:latest"),
];

export type TestableModels = ReturnType<typeof getAvailableModels>;

export function getAvailableModels() {
    return ALL_TESTABLE_MODELS.filter((model) => model.isAvailable());
}
