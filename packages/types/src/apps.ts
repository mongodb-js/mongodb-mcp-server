export interface AppRegistryOptions {
    /**
     * Lazy loaders for bundled app HTML strings, keyed by app name.
     * Each loader returns a Promise that resolves to the HTML string.
     */
    loaders?: Record<string, (() => Promise<string>) | undefined>;
}

export interface IAppRegistry {
    get(appName: string): Promise<string | null>;
    appNames(): string[];
}
