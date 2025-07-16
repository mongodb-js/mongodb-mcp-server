import { LanguageModelV1 } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { ollama } from "ollama-ai-provider";

export interface Model<VercelModel extends LanguageModelV1 = LanguageModelV1> {
    readonly modelName: string;
    readonly provider: string;
    readonly displayName: string;
    isAvailable(): boolean;
    getModel(): VercelModel;
}

export class OpenAIModel implements Model {
    readonly provider = "OpenAI";
    readonly displayName: string;

    constructor(readonly modelName: string) {
        this.displayName = `${this.provider} - ${modelName}`;
    }

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
    readonly provider = "Azure";
    readonly displayName: string;

    constructor(readonly modelName: string) {
        this.displayName = `${this.provider} - ${modelName}`;
    }

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
    readonly provider = "Google";
    readonly displayName: string;

    constructor(readonly modelName: string) {
        this.displayName = `${this.provider} - ${modelName}`;
    }

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
    readonly provider = "Ollama";
    readonly displayName: string;

    constructor(readonly modelName: string) {
        this.displayName = `${this.provider} - ${modelName}`;
    }

    isAvailable(): boolean {
        return true;
    }

    getModel() {
        return ollama(this.modelName);
    }
}

const ALL_TESTABLE_MODELS: Model[] = [new AzureOpenAIModel("gpt-4o")];

export function getAvailableModels(): Model[] {
    return ALL_TESTABLE_MODELS.filter((model) => model.isAvailable());
}
