import { ModelFacade } from "./model.js";
import { GeminiModelFacade } from "./gemini.js";

const ALL_MODELS: ModelFacade[] = [
    new GeminiModelFacade("gemini-2.0-flash"),
    new GeminiModelFacade("gemini-1.5-flash"),
];

export function availableModels(): ModelFacade[] {
    return ALL_MODELS.filter((model) => model.available());
}
