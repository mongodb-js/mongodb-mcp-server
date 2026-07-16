import type { AppConfig } from "./common.js";

const DEFAULT_MCP_BASE_URL = "https://mcp.mongodb.com";
const DEFAULT_TOKEN_TIMEOUT_MS = 10_000;

const MCP_BASE_URL_TO_OAUTH_BASE: Readonly<Record<string, string>> = {
    "https://mcp.mongodb.com": "https://cloud.mongodb.com",
    "https://mcp-dev.mongodb.com": "https://cloud-dev.mongodb.com",
    "https://mcp-qa.mongodb.com": "https://cloud-qa.mongodb.com",
    "https://mcp-staging.mongodb.com": "https://cloud-stage.mongodb.com",
};

function loadPosIntEnvVar(name: string, defaultValue: number, errors: string[]): number {
    const value = process.env[name];
    if (value === undefined) return defaultValue;

    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0) {
        errors.push(`${name} must be a positive integer, got: ${value}`);
        return defaultValue;
    }
    return n;
}

export function loadConfig(): AppConfig {
    const errors: string[] = [];

    const clientId = process.env.MDB_MCP_API_CLIENT_ID;
    if (!clientId) {
        errors.push("MDB_MCP_API_CLIENT_ID is required");
    }

    const clientSecret = process.env.MDB_MCP_API_CLIENT_SECRET;
    if (!clientSecret) {
        errors.push("MDB_MCP_API_CLIENT_SECRET is required");
    }

    const mcpBaseUrl = process.env.MDB_MCP_API_BASE_URL
        ? process.env.MDB_MCP_API_BASE_URL.replace(/\/+$/, "")
        : DEFAULT_MCP_BASE_URL;

    const oauthBaseUrl = MCP_BASE_URL_TO_OAUTH_BASE[mcpBaseUrl] ?? mcpBaseUrl;

    const tokenTimeoutMs = loadPosIntEnvVar("MDB_MCP_TOKEN_TIMEOUT_MS", DEFAULT_TOKEN_TIMEOUT_MS, errors);

    if (errors.length > 0) {
        throw new ConfigurationError(errors);
    }

    return {
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        tokenUrl: new URL("/api/oauth/token", oauthBaseUrl).toString(),
        remoteUrl: mcpBaseUrl,
        tokenTimeoutMs,
    };
}

export class ConfigurationError extends Error {
    constructor(public readonly errors: string[]) {
        super(`Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
        this.name = "ConfigurationError";
    }
}
