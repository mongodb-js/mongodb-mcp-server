import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger } from "@mongodb-js/mcp-core";
import type { ServerMetadata } from "@mongodb-js/mcp-types";
import { UserConfigSchema } from "./config/userConfig.js";

const { capturedApiClientOptions, capturedAuthProviderOptions } = vi.hoisted(() => ({
    capturedApiClientOptions: [] as Array<{ serverMetadata: ServerMetadata }>,
    capturedAuthProviderOptions: [] as Array<{ serverMetadata: ServerMetadata }>,
}));

vi.mock("@mongodb-js/mcp-atlas-api-client", () => ({
    ApiClient: class MockApiClient {
        constructor(options: { serverMetadata: ServerMetadata }) {
            capturedApiClientOptions.push(options);
        }
    },
    ClientCredentialsAuthProvider: class MockClientCredentialsAuthProvider {
        constructor({ serverMetadata }: { serverMetadata: ServerMetadata }) {
            capturedAuthProviderOptions.push({ serverMetadata });
        }
    },
}));

import { createApiClientFromConfig } from "./createApiClientFromConfig.js";

describe("createApiClientFromConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };
    const logger = new NoopLogger();

    beforeEach(() => {
        capturedApiClientOptions.length = 0;
        capturedAuthProviderOptions.length = 0;
    });

    it("should pass serverMetadata to ApiClient", () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        createApiClientFromConfig({
            config,
            serverMetadata,
            logger,
        });

        expect(capturedApiClientOptions).toHaveLength(1);
        expect(capturedApiClientOptions[0]!.serverMetadata).toBe(serverMetadata);
    });

    it("should pass the same serverMetadata to ClientCredentialsAuthProvider when credentials are configured", () => {
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

        expect(capturedApiClientOptions).toHaveLength(1);
        expect(capturedAuthProviderOptions).toHaveLength(1);
        expect(capturedApiClientOptions[0]!.serverMetadata).toBe(serverMetadata);
        expect(capturedAuthProviderOptions[0]!.serverMetadata).toBe(serverMetadata);
    });
});
