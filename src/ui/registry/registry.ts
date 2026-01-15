// Import the auto-generated UI loaders (created by vite build --config vite.ui.config.ts)
import { uiLoaders } from "../lib/loaders.js";

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
