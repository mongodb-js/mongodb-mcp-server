import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { uiMap } from "./uiMap.js";

/**
 * Get the default UI dist path by finding the package root.
 * Uses require.resolve to find the package location, which works in both ESM and CJS.
 */
function getDefaultUIDistPath(): string {
    try {
        // Use require.resolve to find the package.json
        // This works because require.resolve is available in both ESM (via createRequire) and CJS
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const packageJsonPath = require.resolve("mongodb-mcp-server/package.json");
        const packageRoot = dirname(packageJsonPath);
        return join(packageRoot, "dist", "ui");
    } catch {
        // Fallback: try to find dist/ui relative to current working directory
        return join(process.cwd(), "dist", "ui");
    }
}

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 *
 * The registry:
 * - Loads default bundled HTML from dist/ui/ at runtime
 * - Allows adding or replacing UIs via register()
 * - Provides get() to retrieve UI HTML for a tool
 */
export class UIRegistry {
    private customUIs: Map<string, string> = new Map();
    private cache: Map<string, string> = new Map();
    private uiDistPath: string;

    constructor(options?: { uiDistPath?: string; customUIs?: Record<string, string> }) {
        // Use provided path or auto-detect the dist/ui location
        this.uiDistPath = options?.uiDistPath ?? getDefaultUIDistPath();

        // Apply initial custom UIs if provided
        if (options?.customUIs) {
            for (const [toolName, html] of Object.entries(options.customUIs)) {
                this.register(toolName, html);
            }
        }
    }

    /**
     * Register a custom UI HTML string for a tool
     * @param toolName The name of the tool (e.g., 'list-databases')
     * @param html The HTML string to use for this tool's UI
     */
    register(toolName: string, html: string): void {
        this.customUIs.set(toolName, html);
    }

    /**
     * Unregister a custom UI for a tool, reverting to the default (if one exists)
     * @param toolName The name of the tool
     */
    unregister(toolName: string): void {
        this.customUIs.delete(toolName);
    }

    /**
     * Check if a tool has a UI registered (either custom or default)
     * @param toolName The name of the tool
     */
    has(toolName: string): boolean {
        return this.customUIs.has(toolName) || toolName in uiMap;
    }

    /**
     * Get the UI HTML string for a tool
     * Returns the custom UI if registered, otherwise loads the default from disk
     * @param toolName The name of the tool
     * @returns The HTML string, or undefined if no UI exists for this tool
     */
    get(toolName: string): string | undefined {
        // Check for custom UI first
        if (this.customUIs.has(toolName)) {
            return this.customUIs.get(toolName);
        }

        // Check if we have a mapping for this tool
        const componentName = uiMap[toolName];
        if (!componentName) {
            return undefined;
        }

        // Check cache
        if (this.cache.has(toolName)) {
            return this.cache.get(toolName);
        }

        // Try to load from disk (component name -> HTML file)
        const filePath = join(this.uiDistPath, `${componentName}.html`);
        if (!existsSync(filePath)) {
            return undefined;
        }

        try {
            const html = readFileSync(filePath, "utf-8");
            this.cache.set(toolName, html);
            return html;
        } catch {
            return undefined;
        }
    }

    /**
     * Clear the cache of loaded UI HTML strings
     * Useful if the underlying files have changed
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Get all registered tool names (both custom and default)
     */
    getRegisteredTools(): string[] {
        const tools = new Set<string>([...this.customUIs.keys(), ...Object.keys(uiMap)]);
        return Array.from(tools);
    }
}

// Default singleton instance
let defaultRegistry: UIRegistry | undefined;

/**
 * Get or create the default UIRegistry instance
 */
export function getDefaultUIRegistry(): UIRegistry {
    if (!defaultRegistry) {
        defaultRegistry = new UIRegistry();
    }
    return defaultRegistry;
}

/**
 * Set the default UIRegistry instance
 */
export function setDefaultUIRegistry(registry: UIRegistry): void {
    defaultRegistry = registry;
}
