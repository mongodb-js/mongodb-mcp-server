import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import { UserConfigSchema } from "./config/userConfig.js";

const { capturedApiClientArgs, mockAuthProviderFactoryCreate } = vi.hoisted(() => {
    const mockAuthProviderFactoryCreate = vi.fn(
        (options: { credentials?: { clientId?: string; clientSecret?: string } }) =>
            options.credentials?.clientId && options.credentials.clientSecret
                ? { credentials: options.credentials }
                : undefined
    );
    return {
        capturedApiClientArgs: [] as unknown[],
        mockAuthProviderFactoryCreate,
    };
});

vi.mock("@mongodb-js/mcp-atlas-api-client", () => ({
    ApiClient: class MockApiClient {
        constructor(construction: unknown) {
            capturedApiClientArgs.push(construction);
        }
    },
    AuthProviderFactory: {
        create: mockAuthProviderFactoryCreate,
    },
    userAgentFromServerMetadata: (): string => "MongoDB MCP Server/1.2.3-test",
}));

import { createApiClientFromConfig } from "./createApiClientFromConfig.js";

describe("createApiClientFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new CompositeLogger({ loggers: [] });

    beforeEach((): void => {
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
        const {
            options,
            logger: passedLogger,
            authProvider,
        } = capturedApiClientArgs[0] as {
            options: {
                baseUrl: string;
                userAgent: string;
                httpClient: { fetch: unknown; Request: unknown };
            };
            logger: unknown;
            authProvider: unknown;
        };
        expect(options.baseUrl).toBe(config.apiBaseUrl);
        expect(options.userAgent).toBe("MongoDB MCP Server/1.2.3-test");
        expect(typeof options.httpClient.fetch).toBe("function");
        expect(options.httpClient.Request).toBeDefined();
        expect(passedLogger).toBe(logger);
        // No credentials configured → the client is unauthenticated.
        expect(authProvider).toBeUndefined();
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
        const { options, authProvider } = capturedApiClientArgs[0] as {
            options: { userAgent: string };
            authProvider: { credentials: { clientId?: string; clientSecret?: string } } | string;
        };
        expect(options.userAgent).toBe("MongoDB MCP Server/1.2.3-test");
        // Credentials configured → a provider is built from them (not the sentinel).
        expect(authProvider).toEqual({
            credentials: {
                clientId: "test-client-id",
                clientSecret: "test-client-secret",
            },
        });
    });
});
