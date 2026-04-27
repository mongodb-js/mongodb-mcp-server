/**
 * Options accepted by a UI registry implementation.
 */
export type UIRegistryOptions = {
    /**
     * Custom UIs for tools. Function that returns HTML strings for tool
     * names. Use this to add UIs to tools or replace the default bundled
     * UIs.
     */
    customUIs?: (toolName: string) => string | null | Promise<string | null>;
};

/**
 * UI Registry that manages bundled UI HTML strings for tools.
 *
 * Concrete implementation lives in `@mongodb-js/mcp-ui`.
 */
export interface IUIRegistry {
    /**
     * Returns the UI HTML string for the given tool, or `null` if no UI is
     * registered for it.
     */
    get(toolName: string): Promise<string | null>;
}
