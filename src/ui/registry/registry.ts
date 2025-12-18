// Converts kebab-case to PascalCase: "list-databases" -> "ListDatabases"
function toPascalCase(kebabCase: string): string {
    return kebabCase
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

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

        try {
            const module = (await import(`../lib/tools/${toolName}.js`)) as Record<string, string>;
            const exportName = `${toPascalCase(toolName)}Html`;
            const html = module[exportName]; // HTML generated at build time
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
