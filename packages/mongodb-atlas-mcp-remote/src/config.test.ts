import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigurationError } from "./config.js";
import type { AppConfig } from "./common.js";

const TEST_CLIENT_ID = "client-id";
const TEST_CLIENT_SECRET = "client-secret";

const CONFIG_ENV_VARS = [
    "MDB_MCP_API_CLIENT_ID",
    "MDB_MCP_API_CLIENT_SECRET",
    "MDB_MCP_API_BASE_URL",
    "MDB_MCP_TOKEN_TIMEOUT_MS",
] as const;

function stubSA(): void {
    vi.stubEnv("MDB_MCP_API_CLIENT_ID", TEST_CLIENT_ID);
    vi.stubEnv("MDB_MCP_API_CLIENT_SECRET", TEST_CLIENT_SECRET);
}

function loadConfigExpectConfigurationError(): ConfigurationError {
    try {
        loadConfig();
        expect.fail("expected error");
    } catch (e) {
        expect(e).toBeInstanceOf(ConfigurationError);
        return e as ConfigurationError;
    }
}

const DEFAULT_CONFIG: AppConfig = {
    clientId: TEST_CLIENT_ID,
    clientSecret: TEST_CLIENT_SECRET,
    tokenUrl: "https://cloud.mongodb.com/api/oauth/token",
    remoteUrl: "https://mcp.mongodb.com",
    tokenTimeoutMs: 10_000,
};

describe("loadConfig", () => {
    beforeEach(() => {
        // Prevent shell env vars from being picked up
        for (const envVar of CONFIG_ENV_VARS) {
            vi.stubEnv(envVar, undefined);
        }
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    describe("valid configurations", () => {
        it("basic config", () => {
            stubSA();
            expect(loadConfig()).toEqual(DEFAULT_CONFIG);
        });

        it("accepts MDB_MCP_API_BASE_URL", () => {
            stubSA();
            vi.stubEnv("MDB_MCP_API_BASE_URL", "https://test.mongodb.com");
            expect(loadConfig()).toEqual({
                ...DEFAULT_CONFIG,
                tokenUrl: "https://test.mongodb.com/api/oauth/token",
                remoteUrl: "https://test.mongodb.com",
            });
        });

        it.each([
            ["https://mcp.mongodb.com", "https://cloud.mongodb.com"],
            ["https://mcp-dev.mongodb.com", "https://cloud-dev.mongodb.com"],
            ["https://mcp-qa.mongodb.com", "https://cloud-qa.mongodb.com"],
            ["https://mcp-staging.mongodb.com", "https://cloud-stage.mongodb.com"],
        ])("maps known MCP base URL %s to its OAuth base URL %s", (mcpBaseUrl, oauthBaseUrl) => {
            stubSA();
            vi.stubEnv("MDB_MCP_API_BASE_URL", mcpBaseUrl);
            expect(loadConfig()).toEqual({
                ...DEFAULT_CONFIG,
                tokenUrl: `${oauthBaseUrl}/api/oauth/token`,
                remoteUrl: mcpBaseUrl,
            });
        });

        it("strips a trailing slash from MDB_MCP_API_BASE_URL before matching known OAuth mappings", () => {
            stubSA();
            vi.stubEnv("MDB_MCP_API_BASE_URL", "https://mcp-staging.mongodb.com/");
            expect(loadConfig()).toEqual({
                ...DEFAULT_CONFIG,
                tokenUrl: "https://cloud-stage.mongodb.com/api/oauth/token",
                remoteUrl: "https://mcp-staging.mongodb.com",
            });
        });

        it("accepts valid MDB_MCP_TOKEN_TIMEOUT_MS", () => {
            stubSA();
            vi.stubEnv("MDB_MCP_TOKEN_TIMEOUT_MS", "5000");
            expect(loadConfig()).toEqual({ ...DEFAULT_CONFIG, tokenTimeoutMs: 5000 });
        });
    });

    describe("invalid configurations", () => {
        it("throws ConfigurationError when client id and secret are missing", () => {
            const error = loadConfigExpectConfigurationError();
            expect(error.errors).toContain("MDB_MCP_API_CLIENT_ID is required");
            expect(error.errors).toContain("MDB_MCP_API_CLIENT_SECRET is required");
        });

        it("throws ConfigurationError when client id is missing", () => {
            vi.stubEnv("MDB_MCP_API_CLIENT_SECRET", TEST_CLIENT_SECRET);

            const error = loadConfigExpectConfigurationError();
            expect(error.errors).toContain("MDB_MCP_API_CLIENT_ID is required");
        });

        it("throws ConfigurationError when client secret is missing", () => {
            vi.stubEnv("MDB_MCP_API_CLIENT_ID", TEST_CLIENT_ID);

            const error = loadConfigExpectConfigurationError();
            expect(error.errors).toContain("MDB_MCP_API_CLIENT_SECRET is required");
        });

        it("throws ConfigurationError for invalid token timeouts", () => {
            stubSA();
            for (const value of ["abc", "-1", "0"]) {
                vi.stubEnv("MDB_MCP_TOKEN_TIMEOUT_MS", value);

                const error = loadConfigExpectConfigurationError();
                expect(error.errors).toContain(`MDB_MCP_TOKEN_TIMEOUT_MS must be a positive integer, got: ${value}`);
            }
        });
    });
});
