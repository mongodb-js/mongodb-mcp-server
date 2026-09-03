import type { IAppRegistry, AppResourceInfo } from "@mongodb-js/mcp-types";

// The type assertion is needed because the file is auto-generated and may not exist during type checking
type AppLoaders = Record<string, (() => Promise<string>) | undefined>;

import { appLoaders as _appLoaders } from "../lib/appLoaders.js";
const appLoaders = _appLoaders as AppLoaders;

/**
 * Explicit tool -> MCP App (ext-apps) resource URI map.
 *
 * The PoC maps tools 1:1 to app resources, but nothing prevents multiple
 * tools from sharing one resourceUri later (hosts key the widget by
 * resourceUri, and the widget receives the tool result at runtime).
 */
const TOOL_APP_MAP: Record<string, string> = {
    explain: "ui://explain",
};

/**
 * Registry for MCP Apps (ext-apps) widget HTML.
 *
 * Kept separate from {@link UIRegistry} (the mcp-ui dialect): app HTML is
 * served as `ui://` resources via `resources/read` and advertised through
 * tool `_meta.ui.resourceUri` — never embedded into tool results.
 */
export class AppRegistry implements IAppRegistry {
    private cache = new Map<string, string>();

    has(toolName: string): boolean {
        return toolName in TOOL_APP_MAP && appLoaders[toolName] !== undefined;
    }

    resourceUriFor(toolName: string): string | undefined {
        return this.has(toolName) ? TOOL_APP_MAP[toolName] : undefined;
    }

    list(): AppResourceInfo[] {
        return Object.entries(TOOL_APP_MAP)
            .filter(([toolName]) => this.has(toolName))
            .map(([toolName, resourceUri]) => ({ toolName, resourceUri }));
    }

    /**
     * Gets the app HTML string for a tool, or null if none exists.
     */
    async getHtml(toolName: string): Promise<string | null> {
        const cached = this.cache.get(toolName);
        if (cached !== undefined) {
            return cached;
        }

        const loader = appLoaders[toolName];
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
