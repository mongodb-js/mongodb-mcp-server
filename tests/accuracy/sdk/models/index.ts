import { OpenAICompatibleModel } from "./open-ai-compatible-model.js";

export { OpenAICompatibleModel };

export class GeminiModel extends OpenAICompatibleModel {
    constructor(model: string) {
        super(model, {
            baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
            apiKey: process.env.MDB_GEMINI_API_KEY,
        });
    }
}

export class OpenAIModel extends OpenAICompatibleModel {
    constructor(model: string) {
        super(model, {
            apiKey: process.env.MDB_OPEN_AI_API_KEY,
        });
    }
}

export class OllamaModel extends OpenAICompatibleModel {
    constructor(model: string) {
        super(model, {
            baseURL: "http://localhost:11434/v1",
            apiKey: "ollama",
        });
    }
}
