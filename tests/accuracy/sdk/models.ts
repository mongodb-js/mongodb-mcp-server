import { LanguageModelV1 } from "ai";
import { createGoogleGenerativeAI } from "@himanshusinghs/google";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { ollama } from "ollama-ai-provider";

export interface Model<P extends LanguageModelV1 = LanguageModelV1> {
    readonly modelName: string;
    isAvailable(): boolean;
    getModel(): P;
}

export class OpenAIModel implements Model {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return !!process.env.MDB_OPEN_AI_API_KEY;
    }

    getModel() {
        return createOpenAI({
            apiKey: process.env.MDB_OPEN_AI_API_KEY,
        })(this.modelName);
    }
}

export class AzureOpenAIModel implements Model {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return !!process.env.MDB_AZURE_OPEN_AI_API_KEY && !!process.env.MDB_AZURE_OPEN_AI_API_URL;
    }

    getModel() {
        return createAzure({
            baseURL: process.env.MDB_AZURE_OPEN_AI_API_URL,
            apiKey: process.env.MDB_AZURE_OPEN_AI_API_KEY,
            apiVersion: "2024-12-01-preview",
        })(this.modelName);
    }
}

export class GeminiModel implements Model {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return !!process.env.MDB_GEMINI_API_KEY;
    }

    getModel() {
        return createGoogleGenerativeAI({
            apiKey: process.env.MDB_GEMINI_API_KEY,
        })(this.modelName);
    }
}

export class OllamaModel implements Model {
    constructor(readonly modelName: string) {}

    isAvailable(): boolean {
        return true;
    }

    getModel() {
        return ollama(this.modelName);
    }
}

const ALL_TESTABLE_MODELS = [
    // new GeminiModel("gemini-2.0-flash"),
    // new OpenAIModel("gpt-4o"),
    new AzureOpenAIModel("gpt-4o"),
    // new OllamaModel("qwen3:1.7b"),
];

export type TestableModels = ReturnType<typeof getAvailableModels>;

export function getAvailableModels() {
    return ALL_TESTABLE_MODELS.filter((model) => model.isAvailable());
}
