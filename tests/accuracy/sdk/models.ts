import type { LanguageModel } from "ai";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

export interface Model<VercelModel extends LanguageModel = LanguageModel> {
    readonly modelName: string;
    readonly provider: string;
    readonly displayName: string;
    isAvailable(): boolean;
    getModel(): VercelModel;
}

class GroveOpenAICompatibleModel implements Model {
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
            baseURL: "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/openai/v1",
            apiKey: process.env.MDB_GROVE_API_KEY,
            headers: {
                "api-key": process.env.MDB_GROVE_API_KEY ?? "",
            },
        }).chat(this.modelName);
    }
}

class GroveAnthropicModel implements Model {
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
            baseURL: "https://grove-gateway-prod.azure-api.net/grove-foundry-prod/anthropic/v1",
            apiKey: process.env.MDB_GROVE_API_KEY,
            headers: {
                "api-key": process.env.MDB_GROVE_API_KEY ?? "",
            },
        }).chat(this.modelName);
    }
}

class AzureOpenAIModel implements Model {
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

const ALL_TESTABLE_MODELS: Model[] = [
    new GroveOpenAICompatibleModel("gpt-5.5", "OpenAI"),
    new GroveOpenAICompatibleModel("Kimi-K2.6", "Kimi"),
    new GroveOpenAICompatibleModel("grok-4-20-reasoning", "Grok"),
    new GroveOpenAICompatibleModel("deepseek-r1-0528", "DeepSeek"),
    new GroveAnthropicModel("claude-sonnet-4-6"),
    new AzureOpenAIModel("gpt-4o"),
];

function getConfiguredModelAllowList(): Set<string> | null {
    const modelAllowList = process.env.MDB_ACCURACY_MODEL_ALLOWLIST?.trim();
    if (!modelAllowList) {
        return null;
    }

    const models = modelAllowList
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

    if (!models.length) {
        return null;
    }

    return new Set(models);
}

export function getAvailableModels(): Model[] {
    const allowList = getConfiguredModelAllowList();
    return ALL_TESTABLE_MODELS.filter((model) => {
        if (!model.isAvailable()) {
            return false;
        }

        if (!allowList) {
            return true;
        }

        return allowList.has(model.modelName);
    });
}
