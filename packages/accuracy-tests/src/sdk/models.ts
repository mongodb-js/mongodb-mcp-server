import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

const GROVE_BASE_URL = "https://grove-gateway-prod.azure-api.net/grove-foundry-prod";

export interface Model<VercelModel extends LanguageModel = LanguageModel> {
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

    getModel(): LanguageModel {
        return createOpenAI({
            apiKey: process.env.MDB_OPEN_AI_API_KEY,
        }).chat(this.modelName);
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

    getModel(): LanguageModel {
        return createAzure({
            baseURL: process.env.MDB_AZURE_OPEN_AI_API_URL,
            apiKey: process.env.MDB_AZURE_OPEN_AI_API_KEY,
            useDeploymentBasedUrls: true,
            apiVersion: "2024-12-01-preview",
        }).chat(this.modelName);
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

    getModel(): LanguageModel {
        return createGoogleGenerativeAI({
            apiKey: process.env.MDB_GEMINI_API_KEY,
        }).chat(this.modelName);
    }
}

export class GroveOpenAICompatibleModel implements Model {
    readonly provider: string;
    readonly displayName: string;

    constructor(
        readonly modelName: string,
        providerName: string
    ) {
        this.provider = `Grove/${providerName}`;
        this.displayName = `${this.provider} - ${modelName}`;
    }

    isAvailable(): boolean {
        return !!process.env.MDB_GROVE_API_KEY;
    }

    getModel(): LanguageModel {
        return createOpenAI({
            baseURL: `${GROVE_BASE_URL}/openai/v1`,
            apiKey: process.env.MDB_GROVE_API_KEY!,
            headers: { "api-key": process.env.MDB_GROVE_API_KEY! },
        }).chat(this.modelName);
    }
}

export class GroveAnthropicModel implements Model {
    readonly provider = "Grove/Anthropic";
    readonly displayName: string;

    constructor(readonly modelName: string) {
        this.displayName = `${this.provider} - ${modelName}`;
    }

    isAvailable(): boolean {
        return !!process.env.MDB_GROVE_API_KEY;
    }

    getModel(): LanguageModel {
        return createAnthropic({
            baseURL: `${GROVE_BASE_URL}/anthropic/v1`,
            apiKey: process.env.MDB_GROVE_API_KEY!,
            headers: { "api-key": process.env.MDB_GROVE_API_KEY! },
        }).languageModel(this.modelName);
    }
}

const ALL_TESTABLE_MODELS: Model[] = [
    new AzureOpenAIModel("gpt-4o"),
    new GroveOpenAICompatibleModel("gpt-4o", "OpenAI"),
    //new GroveOpenAICompatibleModel("DeepSeek-V4-Pro", "DeepSeek"),
    //new GroveOpenAICompatibleModel("Kimi-K2.6", "Kimi"),
    //new GroveOpenAICompatibleModel("grok-4-20-reasoning", "Grok"),
    new GroveAnthropicModel("claude-sonnet-4-6"),
];

export function getAvailableModels(): Model[] {
    return ALL_TESTABLE_MODELS.filter((model) => model.isAvailable());
}
