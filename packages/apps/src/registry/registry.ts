import type { AppRegistryOptions, IAppRegistry } from "@mongodb-js/mcp-types";

// The type assertion is needed because the file is auto-generated and may not exist during type checking
type AppLoaders = Record<string, (() => Promise<string>) | undefined>;

import { appLoaders as _appLoaders } from "../lib/loaders.js";
const appLoaders = _appLoaders as AppLoaders;

/**
 * App Registry that manages bundled app HTML strings.
 */
export class AppRegistry implements IAppRegistry {
    private loaders: AppLoaders;
    private cache: Map<string, string> = new Map();

    constructor(options?: AppRegistryOptions) {
        this.loaders = options?.loaders ?? appLoaders;
    }

    /**
     * Gets the HTML string for an app, or null if none exists.
     */
    async get(appName: string): Promise<string | null> {
        const cached = this.cache.get(appName);
        if (cached !== undefined) {
            return cached;
        }

        const loader = this.loaders[appName];
        if (!loader) {
            return null;
        }

        try {
            const html = await loader();
            if (!process.env.MCPAPP_DEV) {
                // If "dev mode" is not enabled, cache the loaded HTML to avoid
                // unnecessary async loading on subsequent calls. In dev mode we
                // don't cache so that we don't have to restart the MCP server
                // every time we change an app's HTML.
                this.cache.set(appName, html);
            }
            return html;
        } catch {
            return null;
        }
    }

    /**
     * Returns the names of all registered apps.
     */
    appNames(): string[] {
        return Object.keys(this.loaders);
    }
}
