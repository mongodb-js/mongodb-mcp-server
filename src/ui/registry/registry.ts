/**
 * UI Registry that manages bundled UI HTML strings for tools.
 */
export class UIRegistry {
    private customUIs: Map<string, string> = new Map();
    private cache: Map<string, string> = new Map();

    constructor(options?: { customUIs?: Record<string, string> }) {
        if (options?.customUIs) {
            for (const [toolName, html] of Object.entries(options.customUIs)) {
                this.customUIs.set(toolName, html);
            }
        }
    }

    /**
     * Gets the UI HTML string for a tool, or null if none exists.
     */
    async get(toolName: string): Promise<string | null> {
        const customUI = this.customUIs.get(toolName);
        if (customUI !== undefined) {
            return customUI;
        }

        const cached = this.cache.get(toolName);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const module = (await import(`../generated/tools/${toolName}.js`)) as { default: string };
            this.cache.set(toolName, module.default);
            return module.default;
        } catch {
            return null;
        }
    }
}
