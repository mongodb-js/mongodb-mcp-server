import { describe, expect, it } from "vitest";
import { CliServer } from "@mongodb-js/mcp-cli";
import { McpServer } from "@modelcontextprotocol/server";
import { CompositeLogger, Keychain, NoopTelemetry } from "@mongodb-js/mcp-core";
import { Elicitation } from "@mongodb-js/mcp-core";
import {
    connectionErrorHandler,
    DeviceId,
    ExportsManager,
    FakeConnectionManager,
    MCPConnectionStore,
    type ConnectionRegistry,
    type ConnectionManager,
} from "@mongodb-js/mcp-tools-mongodb";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import { createTestApiClient, defaultTestConfig } from "./integrationHelpers.js";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";

describe("CliServer construction (individually-injected services)", () => {
    const createCliServer = (): {
        mcpServer: CliServer;
        logger: CompositeLogger;
        keychain: Keychain;
        connectionRegistry: ConnectionRegistry;
        exportsManager: ExportsManager;
        apiClient: ApiClient;
    } => {
        const logger = new CompositeLogger();
        const keychain = new Keychain();
        const exportsManager = ExportsManager.init({
            options: {
                exportsPath: defaultTestConfig.exportsPath,
                exportTimeoutMs: defaultTestConfig.exportTimeoutMs,
                exportCleanupIntervalMs: defaultTestConfig.exportCleanupIntervalMs,
            },
            logger,
        });
        class TestStore extends MCPConnectionStore {
            protected override createConnectionManager(): ConnectionManager {
                return new FakeConnectionManager();
            }
        }
        const connectionRegistry = new TestStore({
            options: defaultTestConfig,
            logger,
            deviceId: DeviceId.create(logger),
        }).view();
        const apiClient = createTestApiClient({
            baseUrl: defaultTestConfig.apiBaseUrl,
            serverMetadata: { mcpServerName: "test", version: "1" },
            logger,
            clientId: "test",
            clientSecret: "test",
        });

        const mcpServer = new CliServer({
            config: defaultTestConfig,
            logger,
            keychain,
            connectionRegistry,
            exportsManager,
            apiClient,
            connectionErrorHandler,
            mcpServer: new McpServer({ name: "test", version: "1.0" }),
            telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
            elicitation: new Elicitation({ server: {} as never }),
            metrics: new MockMetrics(),
            serverMetadata: {
                mcpServerName: "test-server",
                version: "1.0",
                engines: {
                    node: "20.0.0",
                },
            },
        });

        return { mcpServer, logger, keychain, connectionRegistry, exportsManager, apiClient };
    };

    describe("construction", () => {
        it("exposes the injected service references as discrete fields", () => {
            const { mcpServer, logger, keychain, connectionRegistry, exportsManager, apiClient } = createCliServer();

            expect(mcpServer.config).toBe(defaultTestConfig);
            expect(mcpServer.logger).toBe(logger);
            expect(mcpServer.keychain).toBe(keychain);
            expect(mcpServer.connectionRegistry).toBe(connectionRegistry);
            expect(mcpServer.exportsManager).toBe(exportsManager);
            expect(mcpServer.apiClient).toBe(apiClient);
            expect(mcpServer.connectionErrorHandler).toBe(connectionErrorHandler);
        });

        it("shares the injected connection registry identity across server instances", () => {
            const { mcpServer, connectionRegistry, logger, keychain, exportsManager, apiClient } = createCliServer();

            const other = new CliServer({
                config: defaultTestConfig,
                logger,
                keychain,
                connectionRegistry,
                exportsManager,
                apiClient,
                connectionErrorHandler,
                mcpServer: new McpServer({ name: "test", version: "1.0" }),
                telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
                elicitation: new Elicitation({ server: {} as never }),
                metrics: new MockMetrics(),
                serverMetadata: {
                    mcpServerName: "test-server",
                    version: "1.0",
                    engines: {
                        node: "20.0.0",
                    },
                },
            });

            expect(mcpServer.connectionRegistry).toBe(connectionRegistry);
            expect(other.connectionRegistry).toBe(connectionRegistry);
            expect(other.connectionRegistry).toBe(mcpServer.connectionRegistry);
        });
    });
});
