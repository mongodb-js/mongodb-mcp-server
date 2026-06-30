import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadConfig, ConfigurationError } from "./config.js";
import { LOG_LEVELS } from "./common.js";
import type { AppConfig } from "./common.js";

const TEST_CLIENT_ID = "client-id";
const TEST_CLIENT_SECRET = "client-secret";

const CONFIG_ENV_VARS = [
    "MDB_MCP_API_CLIENT_ID",
    "MDB_MCP_API_CLIENT_SECRET",
    "MDB_MCP_API_BASE_URL",
    "MDB_MCP_LOG_LEVEL",
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
    remoteUrl: "https://cloud.mongodb.com/api/private/mcp",
    logLevel: "info",
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

        it("accepts all valid log levels", () => {
            stubSA();
            for (const level of LOG_LEVELS) {
                vi.stubEnv("MDB_MCP_LOG_LEVEL", level);
                expect(loadConfig()).toEqual({ ...DEFAULT_CONFIG, logLevel: level });
            }
        });

        it("accepts MDB_MCP_API_BASE_URL", () => {
            stubSA();
            vi.stubEnv("MDB_MCP_API_BASE_URL", "https://test.mongodb.com");
            expect(loadConfig()).toEqual({
                ...DEFAULT_CONFIG,
                tokenUrl: "https://test.mongodb.com/api/oauth/token",
                remoteUrl: "https://test.mongodb.com/api/private/mcp",
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

        it("throws ConfigurationError for invalid log levels", () => {
            stubSA();
            vi.stubEnv("MDB_MCP_LOG_LEVEL", "invalid");

            const error = loadConfigExpectConfigurationError();
            expect(error.errors[0]).toContain("MDB_MCP_LOG_LEVEL must be one of");
            expect(error.errors[0]).toContain("got: invalid");
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
