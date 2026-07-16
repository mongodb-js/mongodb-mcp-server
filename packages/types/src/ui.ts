export interface UIRegistryOptions {
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

    /**
     * Lazy loaders for bundled UI HTML strings, keyed by tool name.
     * Each loader returns a Promise that resolves to the HTML string.
     */
    loaders?: Record<string, (() => Promise<string>) | undefined>;
}

export interface IUIRegistry {
    get(toolName: string): Promise<string | null>;
}
