/**
 * Package info interface used by the setup wizard.
 */
export interface SetupPackageInfo {
    version: string;
    mcpServerName: string;
    engines: {
        node: string;
    };
}

/**
 * Config interface used by the setup wizard.
 */
export interface SetupConfig {
    apiBaseUrl: string;
    telemetry: "enabled" | "disabled";
    connectionString?: string;
    transport: "stdio" | "http";
    httpHost: string;
}
