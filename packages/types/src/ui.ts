import type { MaybePromise } from "./helpers.js";

export type UIRegistryOptions = {
    customUIs?: (toolName: string) => MaybePromise<string | null>;
};

export interface IUIRegistry {
    get(toolName: string): Promise<string | null>;
}
