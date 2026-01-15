// Converts kebab-case to PascalCase: "list-databases" -> "ListDatabases"
function toPascalCase(kebabCase: string): string {
    return kebabCase
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
}

// Lazy-loaded UI modules discovered at build time via import.meta.glob
// This works in both Vitest (resolves .ts) and production builds (resolves compiled .js)
const uiModules = import.meta.glob<Record<string, string>>("../lib/tools/*.ts");

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

        const modulePath = `../lib/tools/${toolName}.ts`;
        const loader = uiModules[modulePath];
        if (!loader) {
            return null;
        }

        try {
            const module = await loader();
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
