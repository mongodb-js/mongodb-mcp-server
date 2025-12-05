import { uiHtml } from "../generated/uiHtml.js";

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 *
 * The default UIs are embedded at build time via the generated uiHtml module.
 * Custom UIs can be provided at runtime to override or extend the defaults.
 */
export class UIRegistry {
    private customUIs: Map<string, string> = new Map();

    constructor(options?: { customUIs?: Record<string, string> }) {
        if (options?.customUIs) {
            for (const [toolName, html] of Object.entries(options.customUIs)) {
                this.customUIs.set(toolName, html);
            }
        }
    }

    /**
     * Get the UI HTML string for a tool.
     * @param toolName The name of the tool (kebab-case, e.g., "list-databases")
     * @returns The HTML string, or undefined if no UI exists for this tool
     */
    get(toolName: string): string | undefined {
        return this.customUIs.get(toolName) ?? uiHtml[toolName];
    }

    /**
     * Check if a UI exists for a tool.
     * @param toolName The name of the tool
     * @returns True if a UI exists (custom or built-in)
     */
    has(toolName: string): boolean {
        return this.customUIs.has(toolName) || toolName in uiHtml;
    }

    /**
     * Get all available tool names that have UIs.
     * @returns Array of tool names
     */
    getAvailableTools(): string[] {
        const builtIn = Object.keys(uiHtml);
        const custom = Array.from(this.customUIs.keys());
        return [...new Set([...builtIn, ...custom])];
    }
}
