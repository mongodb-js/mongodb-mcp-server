// The type assertion is needed because the file is auto-generated and may not exist during type checking
type UILoaders = Record<string, (() => Promise<string>) | undefined>;

import { uiLoaders as _uiLoaders } from "../lib/loaders.js";
const uiLoaders = _uiLoaders as UILoaders;

export type UIRegistryOptions = {
    /**
     * Custom UIs for tools. Function that returns HTML strings for tool names.
     * Use this to add UIs to tools or replace the default bundled UIs.
     * The function is called lazily when a UI is requested, allowing you to
     * defer loading large HTML files until needed.
     *
     * ```ts
     * import { readFileSync } from 'fs';
     * const server = new Server({
     *     // ... other options
     *     customUIs: (toolName) => {
     *         if (toolName === 'list-databases') {
     *             return readFileSync('./my-custom-ui.html', 'utf-8');
     *         }
     *         return null;
     *     }
     * });
     * ```
     */
    customUIs?: (toolName: string) => string | null | Promise<string | null>;
};

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 */
export class UIRegistry {
    private customUIs?: (toolName: string) => string | null | Promise<string | null>;
    private cache: Map<string, string> = new Map();

    constructor(options?: { customUIs?: (toolName: string) => string | null | Promise<string | null> }) {
        this.customUIs = options?.customUIs;
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

        const loader = uiLoaders[toolName];
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
