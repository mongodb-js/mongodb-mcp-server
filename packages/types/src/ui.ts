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

/** MIME type required by the MCP Apps (ext-apps) extension for UI resources. */
export const MCP_APPS_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

export interface AppResourceInfo {
    /** The MCP tool this app resource renders results for. */
    toolName: string;
    /** The ui:// URI the app HTML is served under, e.g. "ui://explain". */
    resourceUri: string;
}

/**
 * Registry for MCP Apps (ext-apps) widget HTML.
 *
 * Kept deliberately separate from {@link IUIRegistry} (the mcp-ui dialect):
 * app resources are served via `resources/read` and referenced from tool
 * `_meta.ui.resourceUri`, never embedded into tool results.
 */
export interface IAppRegistry {
    /** Sync check — called at tool registration time when building tool `_meta`. */
    has(toolName: string): boolean;
    /** Explicit tool → resource URI mapping (may be N:1 if tools share an app). */
    resourceUriFor(toolName: string): string | undefined;
    /** All app resources to register on the server. */
    list(): AppResourceInfo[];
    /** Lazy HTML lookup with caching. */
    getHtml(toolName: string): Promise<string | null>;
}
