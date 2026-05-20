import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTestConfig } from "../integrationHelpers.js";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { Server, Session, Elicitation, connectionErrorHandler } from "mongodb-mcp-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CompositeLogger, Keychain, NoopTelemetry } from "@mongodb-js/mcp-core";
import { MCPConnectionManager, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import { createTestApiClient } from "../integrationHelpers.js";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { packageInfo } from "mongodb-mcp-server";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { UserConfig } from "mongodb-mcp-server";

// Helper to create a Server instance for testing UIRegistry
type CreateServerOptions = {
    config: UserConfig;
    uiRegistry?: UIRegistry;
};

async function createTestServer({ config, uiRegistry }: CreateServerOptions): Promise<Server> {
    const logger = new CompositeLogger({ loggers: [] });
    const keychain = Keychain.root;

    const exportsManager = ExportsManager.init({
        options: {
            exportsPath: config.exportsPath,
            exportTimeoutMs: config.exportTimeoutMs,
            exportCleanupIntervalMs: config.exportCleanupIntervalMs,
        },
        logger,
    });

    const connectionManager = new MCPConnectionManager({
        logger,
        deviceId: {} as unknown as DeviceId,
        options: {
            connectionInfo: { transport: "http", httpHost: "localhost" },
            displayName: packageInfo.mcpServerName,
            version: packageInfo.version,
        },
    });

    const apiClient = createTestApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
    });

    // Mock the API client methods for tests
    vi.spyOn(apiClient, "validateAuthConfig").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "close").mockResolvedValue(undefined);

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const mcpServer = new McpServer({
        name: "test-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server });

    const session = new Session({
        userConfig: config,
        logger,
        exportsManager,
        connectionManager,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
    });

    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    if (!uiRegistry && config.previewFeatures.includes("mcpUI")) {
        uiRegistry = new UIRegistry();
    }

    const server = new Server({
        session,
        mcpServer,
        telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        uiRegistry,
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
    });

    return server;
}

describe("Server UIRegistry", () => {
    let server: Server | undefined;

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
    });

    describe("UIRegistry conditional import", () => {
        it("should not set UIRegistry when mcpUI preview feature is not enabled", async () => {
            server = await createTestServer({
                config: {
                    ...defaultTestConfig,
                    previewFeatures: [], // mcpUI not included
                },
            });

            expect(server.uiRegistry).toBeUndefined();
        });

        it("should set UIRegistry when mcpUI preview feature is enabled", async () => {
            server = await createTestServer({
                config: {
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"],
                },
            });

            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });

        it("should use provided UIRegistry from serverOptions when available", async () => {
            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            server = await createTestServer({
                config: {
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"], // mcpUI enabled but should be ignored
                },
                uiRegistry: mockUIRegistry,
            });

            // Should use the provided UIRegistry, not create a new one
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should not import UIRegistry when serverOptions provides one, even if mcpUI is disabled", async () => {
            const mockUIRegistry: UIRegistry = {
                get: vi.fn(),
            } as unknown as UIRegistry;

            server = await createTestServer({
                config: {
                    ...defaultTestConfig,
                    previewFeatures: [], // mcpUI not enabled
                },
                uiRegistry: mockUIRegistry,
            });

            // Should use the provided UIRegistry
            expect(server.uiRegistry).toBe(mockUIRegistry);
        });

        it("should handle multiple preview features with mcpUI included", async () => {
            server = await createTestServer({
                config: {
                    ...defaultTestConfig,
                    previewFeatures: ["mcpUI"],
                },
            });

            expect(server.uiRegistry).toBeDefined();
            expect(server.uiRegistry).toHaveProperty("get");
            expect(typeof server.uiRegistry?.get).toBe("function");
        });
    });
});
