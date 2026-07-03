import type { AppConfig } from "./common.js";

const DEFAULT_BASE_URL = "https://cloud.mongodb.com";
const DEFAULT_TOKEN_TIMEOUT_MS = 10_000;

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

    const baseUrl = process.env.MDB_MCP_API_BASE_URL
        ? process.env.MDB_MCP_API_BASE_URL.replace(/\/+$/, "")
        : DEFAULT_BASE_URL;

    const tokenTimeoutMs = loadPosIntEnvVar("MDB_MCP_TOKEN_TIMEOUT_MS", DEFAULT_TOKEN_TIMEOUT_MS, errors);

    if (errors.length > 0) {
        throw new ConfigurationError(errors);
    }

    return {
        clientId: clientId ?? "",
        clientSecret: clientSecret ?? "",
        tokenUrl: new URL("/api/oauth/token", baseUrl).toString(),
        remoteUrl: new URL("/api/private/mcp", baseUrl).toString(), // TODO: Switch to https://mcp.mongodb.com/mcp once available across all environments.
        tokenTimeoutMs,
    };
}

export class ConfigurationError extends Error {
    constructor(public readonly errors: string[]) {
        super(`Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
        this.name = "ConfigurationError";
    }
}
