import {
    StreamableHttpRunner,
    MonitoringServer,
    createDefaultSessionStore,
    type TransportRunnerConfig,
} from "@mongodb-mcp/transport";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { UserConfig } from "../../../src/lib.js";
import { defaultTestConfig, expectDefined } from "../helpers.js";
import { CompositeLogger } from "../../../src/common/logging/index.js";
import { DeviceId } from "../../../src/helpers/deviceId.js";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-mcp/monitoring";

describe("createSessionConfig", () => {
    const userConfig = defaultTestConfig;
    let runner: StreamableHttpRunner;
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;

    // Helper to start runner with config
    const startRunner = async (
        config: {
            userConfig?: typeof userConfig;
            createSessionConfig?: TransportRunnerConfig["createSessionConfig"];
        } = {}
    ): Promise<StreamableHttpRunner> => {
        const effectiveUserConfig = { ...userConfig, httpPort: 0, ...config.userConfig };
        const logger = new CompositeLogger();
        const deviceId = DeviceId.create(logger);
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const sessionStore = createDefaultSessionStore<StreamableHTTPServerTransport>({
            idleTimeoutMs: effectiveUserConfig.idleTimeoutMs,
            notificationTimeoutMs: effectiveUserConfig.notificationTimeoutMs,
            logger,
            metrics,
        });

        const host = effectiveUserConfig.monitoringServerHost ?? effectiveUserConfig.healthCheckHost;
        const port = effectiveUserConfig.monitoringServerPort ?? effectiveUserConfig.healthCheckPort;
        const monitoringServer =
            host !== undefined && port !== undefined
                ? new MonitoringServer({
                      host,
                      port,
                      features: effectiveUserConfig.monitoringServerFeatures,
                      logger,
                      metrics,
                  })
                : undefined;

        runner = new StreamableHttpRunner({
            userConfig: effectiveUserConfig,
            logger,
            deviceId,
            metrics,
            sessionStore,
            monitoringServer,
            createSessionConfig: config.createSessionConfig,
        });
        await runner.start();
        return runner;
    };

    // Helper to setup server and get user config
    const getServerConfig = async (): Promise<UserConfig> => {
        const server = await runner["setupServer"]();
        return server.userConfig;
    };

    // Helper to create and connect client
    const createConnectedClient = async (): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> => {
        client = new Client({ name: "test-client", version: "1.0.0" });
        transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`));
        await client.connect(transport);
        return { client, transport };
    };

    afterEach(async () => {
        if (client) {
            await client.close();
            client = undefined;
        }
        if (transport) {
            await transport.close();
            transport = undefined;
        }
        if (runner) {
            await runner.close();
        }
    });

    describe("basic functionality", () => {
        it("should use the modified config from createSessionConfig", async () => {
            await startRunner({
                createSessionConfig: async ({ userConfig }) =>
                    Promise.resolve({
                        ...userConfig,
                        apiBaseUrl: "https://test-api.mongodb.com/",
                    }),
            });

            const config = await getServerConfig();
            expect(config.apiBaseUrl).toBe("https://test-api.mongodb.com/");
        });

        it("should work without a createSessionConfig", async () => {
            await startRunner();

            const config = await getServerConfig();
            expect(config.apiBaseUrl).toBe(userConfig.apiBaseUrl);
        });
    });

    describe("connection string modification", () => {
        it("should allow modifying connection string via createSessionConfig", async () => {
            await startRunner({
                userConfig: { ...userConfig, connectionString: undefined },
                createSessionConfig: async ({ userConfig }) => {
                    // Simulate fetching connection string from environment or secrets
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    return {
                        ...userConfig,
                        connectionString: "mongodb://test-server:27017/test-db",
                    };
                },
            });

            const config = await getServerConfig();
            expect(config.connectionString).toBe("mongodb://test-server:27017/test-db");
        });
    });

    describe("server integration", () => {
        it("should successfully initialize server with createSessionConfig and serve requests", async () => {
            await startRunner({
                createSessionConfig: async ({ userConfig }) => {
                    // Simulate async config modification
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    return {
                        ...userConfig,
                        readOnly: true, // Enable read-only mode
                    };
                },
            });

            await createConnectedClient();
            const response = await client?.listTools();
            expectDefined(response);

            expect(response.tools).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);

            // Verify read-only mode is applied - insert-many should not be available
            const writeTools = response.tools.filter((tool) => tool.name === "insert-many");
            expect(writeTools.length).toBe(0);

            // Verify read tools are available
            const readTools = response.tools.filter((tool) => tool.name === "find");
            expect(readTools.length).toBe(1);
        });
    });

    describe("error handling", () => {
        it("should propagate errors from configProvider on client connection", async () => {
            await startRunner({
                createSessionConfig: async () => {
                    return Promise.reject(new Error("Failed to fetch config"));
                },
            });

            // Error should occur when a client tries to connect
            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`));

            await expect(client.connect(transport)).rejects.toThrow();
        });
    });
});
