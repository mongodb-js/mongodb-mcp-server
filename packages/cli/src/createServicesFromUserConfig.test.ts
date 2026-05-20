import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoopLogger, type CompositeLogger } from "@mongodb-js/mcp-core";
import type * as McpAtlasTelemetry from "@mongodb-js/mcp-atlas-telemetry";
import type * as McpCore from "@mongodb-js/mcp-core";
import type * as McpToolsMongodb from "@mongodb-js/mcp-tools-mongodb";
import { UserConfigSchema } from "./config/userConfig.js";

const { capturedApiClientOptions, capturedAuthProviderOptions } = vi.hoisted(() => ({
    capturedApiClientOptions: [] as Array<{ options: { userAgent: string } }>,
    capturedAuthProviderOptions: [] as Array<{ userAgent: string }>,
}));

vi.mock("./utils/loggers.js", () => ({
    createDefaultLoggers: vi.fn().mockResolvedValue(new NoopLogger() as CompositeLogger),
}));

vi.mock("@mongodb-js/mcp-tools-mongodb", async (importOriginal) => {
    const actual: typeof McpToolsMongodb = await importOriginal();
    return {
        ...actual,
        ExportsManager: {
            init: vi.fn().mockReturnValue({}),
        },
        DeviceId: {
            create: vi.fn().mockReturnValue({}),
        },
        MCPConnectionManager: vi.fn().mockImplementation(function MockMCPConnectionManager() {
            return {};
        }),
    };
});

vi.mock("@mongodb-js/mcp-tools-atlas-local", () => ({
    createAtlasLocalClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@mongodb-js/mcp-atlas-telemetry", async (importOriginal) => {
    const actual: typeof McpAtlasTelemetry = await importOriginal();
    return {
        ...actual,
        AtlasTelemetry: {
            create: vi.fn().mockReturnValue({}),
        },
    };
});

vi.mock("@mongodb-js/mcp-atlas-api-client", () => ({
    ApiClient: class MockApiClient {
        constructor(options: { options: { userAgent: string } }) {
            capturedApiClientOptions.push(options);
        }
    },
    ClientCredentialsAuthProvider: class MockClientCredentialsAuthProvider {
        constructor({ options }: { options: { userAgent: string } }) {
            capturedAuthProviderOptions.push(options);
        }
    },
}));

vi.mock("@mongodb-js/mcp-core", async (importOriginal) => {
    const actual: typeof McpCore = await importOriginal();
    return {
        ...actual,
        McpServer: class MockMcpServer {
            server = {};
        },
        Elicitation: class MockElicitation {},
    };
});

vi.mock("./cliSession.js", () => ({
    CliSession: class MockCliSession {},
}));

vi.mock("./cliServer.js", () => ({
    CliServer: class MockCliServer {},
}));

import { createServicesFromUserConfig } from "./createServicesFromUserConfig.js";

describe("createServicesFromUserConfig", () => {
    const serverMetadata = {
        mcpServerName: "MongoDB MCP Server",
        version: "1.2.3-test",
    };

    beforeEach(() => {
        capturedApiClientOptions.length = 0;
        capturedAuthProviderOptions.length = 0;
    });

    it("should not include hostname in userAgent passed to ApiClient", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
        });

        await createServicesFromUserConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
        });

        expect(capturedApiClientOptions).toHaveLength(1);
        const userAgent = capturedApiClientOptions[0]!.options.userAgent;
        expect(userAgent).toBe("MongoDB MCP Server/1.2.3-test");
        expect(userAgent).not.toContain("; unknown");
        expect(userAgent).not.toMatch(/\bhostname\b/i);
        expect(userAgent).not.toMatch(/\([^)]*;[^)]*\)/);
    });

    it("should pass the same userAgent to ClientCredentialsAuthProvider when credentials are configured", async () => {
        const config = UserConfigSchema.parse({
            telemetry: "disabled",
            loggers: ["stderr"],
            apiClientId: "test-client-id",
            apiClientSecret: "test-client-secret",
        });

        await createServicesFromUserConfig({
            config,
            serverMetadata,
            tools: [],
            resources: [],
        });

        expect(capturedApiClientOptions).toHaveLength(1);
        expect(capturedAuthProviderOptions).toHaveLength(1);
        const expectedUserAgent = "MongoDB MCP Server/1.2.3-test";
        expect(capturedApiClientOptions[0]!.options.userAgent).toBe(expectedUserAgent);
        expect(capturedAuthProviderOptions[0]!.userAgent).toBe(expectedUserAgent);
        expect(capturedAuthProviderOptions[0]!.userAgent).not.toMatch(/\bhostname\b/i);
    });
});
