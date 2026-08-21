import type { UIRegistryOptions, IUIRegistry } from "@mongodb-js/mcp-types";

// The type assertion is needed because the file is auto-generated and may not exist during type checking
type UILoaders = Record<string, (() => Promise<string>) | undefined>;

import { uiLoaders as _uiLoaders } from "../lib/loaders.js";
const uiLoaders = _uiLoaders as UILoaders;

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 */
export class UIRegistry implements IUIRegistry {
    private customUIs?: (toolName: string) => string | null | Promise<string | null>;
    private loaders: UILoaders;
    private cache: Map<string, string> = new Map();

    constructor(options?: UIRegistryOptions) {
        this.customUIs = options?.customUIs;
        this.loaders = options?.loaders ?? uiLoaders;
    }

    /**
     * Gets the UI HTML string for a tool, or null if none exists.
     */
    async get(toolName: string): Promise<string | null> {
        if (this.customUIs) {
            const customUI = await this.customUIs(toolName);
            if (customUI !== null && customUI !== undefined) {
                return customUI;
            }
        }

        const cached = this.cache.get(toolName);
        if (cached !== undefined) {
            return cached;
        }

        const loader = this.loaders[toolName];
        if (!loader) {
            return null;
        }

        try {
            const html = await loader();
            if (html === undefined) {
                return null;
            }
            this.cache.set(toolName, html);
            return html;
        } catch {
            return null;
        }
    }
}
