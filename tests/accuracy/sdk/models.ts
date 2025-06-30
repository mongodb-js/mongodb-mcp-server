import { LanguageModelV1 } from "ai";
import { createGoogleGenerativeAI } from "@himanshusinghs/google";
import { ollama } from "ollama-ai-provider";

export interface Model<P extends LanguageModelV1 = LanguageModelV1> {
    isAvailable(): boolean;
    getModel(): P;
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
    new GeminiModel("gemini-1.5-flash"),
    // new GeminiModel("gemini-2.0-flash"),
    // new OllamaModel("qwen3:latest"),
];

export type TestableModels = ReturnType<typeof getAvailableModels>;

export function getAvailableModels() {
    return ALL_TESTABLE_MODELS.filter((model) => model.isAvailable());
}
