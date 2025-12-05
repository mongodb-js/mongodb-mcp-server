import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { uiMap } from "./uiMap.js";

/**
 * Get the default UI dist path by finding the package root.
 */
function getDefaultUIDistPath(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const packageJsonPath = require.resolve("mongodb-mcp-server/package.json");
        const packageRoot = dirname(packageJsonPath);
        return join(packageRoot, "dist", "ui");
    } catch {
        return join(process.cwd(), "dist", "ui");
    }
}

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 *
 * The registry:
 * - Loads default bundled HTML from dist/ui/ at runtime
 * - Allows custom UIs via constructor options
 * - Provides get() to retrieve UI HTML for a tool
 */
export class UIRegistry {
    private customUIs: Map<string, string> = new Map();
    private cache: Map<string, string> = new Map();
    private uiDistPath: string;

    constructor(options?: { customUIs?: Record<string, string> }) {
        this.uiDistPath = getDefaultUIDistPath();

        if (options?.customUIs) {
            for (const [toolName, html] of Object.entries(options.customUIs)) {
                this.customUIs.set(toolName, html);
            }
        }
    }

    /**
     * Get the UI HTML string for a tool.
     * Returns the custom UI if provided, otherwise loads the default from disk.
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

        // Try to load from disk
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
}
