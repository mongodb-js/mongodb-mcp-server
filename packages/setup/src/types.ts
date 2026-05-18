/**
 * Minimal package info interface needed by the setup wizard.
 * This is injected by the caller to avoid a dependency on the main package.
 */
export interface SetupPackageInfo {
    version: string;
    mcpServerName: string;
    engines: { node: string };
}

/**
 * Minimal config interface needed by the setup wizard.
 * This is a subset of UserConfig from the main package.
 */
export interface SetupConfig {
    apiBaseUrl: string;
    telemetry: "enabled" | "disabled";
    connectionString?: string;
    transport: "stdio" | "http";
    httpHost: string;
}
