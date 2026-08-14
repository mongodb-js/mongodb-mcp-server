import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import { UserConfigSchema } from "./config/userConfig.js";

const { capturedApiClientArgs } = vi.hoisted(() => ({
    capturedApiClientArgs: [] as unknown[],
}));

vi.mock("@mongodb-js/mcp-atlas-api-client", () => ({
    ApiClient: class MockApiClient {
        constructor(options: unknown) {
            capturedApiClientArgs.push(options);
        }
    },
    userAgentFromServerMetadata: () => "MongoDB MCP Server/1.2.3-test",
}));

import { createApiClientFromConfig } from "./createApiClientFromConfig.js";

describe("createApiClientFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new CompositeLogger({ loggers: [] });

    beforeEach(() => {
        capturedApiClientArgs.length = 0;
    });

    it("should pass baseUrl, the derived userAgent, and an injected httpClient to ApiClient", () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        createApiClientFromConfig({
            config,
            serverMetadata,
            logger,
        });

        expect(capturedApiClientArgs).toHaveLength(1);
        const options = capturedApiClientArgs[0] as {
            baseUrl: string;
            userAgent: string;
            credentials: { clientId?: string; clientSecret?: string };
            httpClient: { fetch: unknown; Request: unknown };
        };
        expect(options.baseUrl).toBe(config.apiBaseUrl);
        expect(options.userAgent).toBe("MongoDB MCP Server/1.2.3-test");
        expect(options.credentials).toEqual({ clientId: undefined, clientSecret: undefined });
        expect(typeof options.httpClient.fetch).toBe("function");
        expect(options.httpClient.Request).toBeDefined();
    });

    it("should pass configured credentials to ApiClient when they are set", () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
            apiClientId: "test-client-id",
            apiClientSecret: "test-client-secret",
        });

        createApiClientFromConfig({
            config,
            serverMetadata,
            logger,
        });

        expect(capturedApiClientArgs).toHaveLength(1);
        const options = capturedApiClientArgs[0] as {
            userAgent: string;
            credentials: { clientId?: string; clientSecret?: string };
        };
        expect(options.userAgent).toBe("MongoDB MCP Server/1.2.3-test");
        expect(options.credentials).toEqual({
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
        });
    });
});
