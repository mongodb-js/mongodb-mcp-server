import { StreamableHttpRunner, MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import { SessionStore, CompositeLogger, Keychain, NoopTelemetry } from "@mongodb-js/mcp-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import type { UserConfig } from "mongodb-mcp-server";
import {
    CliServer,
    CliSession,
    Elicitation,
    connectionErrorHandler,
    MCPConnectionManager,
    ExportsManager,
    packageInfo,
} from "mongodb-mcp-server";
import { AllTools } from "mongodb-mcp-server";
import { defaultTestConfig, expectDefined, sleep } from "../integrationHelpers.js";
import type { HttpServerOptions, SessionManagementOptions } from "@mongodb-js/mcp-types";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createTestApiClient } from "../integrationHelpers.js";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { vi } from "vitest";

// Helper to create a full Server instance for tests
async function createTestServer(config: UserConfig): Promise<CliServer> {
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

    const session = new CliSession({
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

    const server = new CliServer({
        session,
        mcpServer,
        telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
        tools: AllTools,
    });

    return server;
}

// Custom MCPHttpServer that applies config modifications from a provider function
class ConfigModifyingMCPHttpServer extends MCPHttpServer<CliServer> {
    private baseConfig: UserConfig;
    private configModifier: (config: UserConfig) => Promise<UserConfig>;

    constructor({
        baseConfig,
        configModifier,
        options,
        logger,
        metrics,
        sessionStore,
    }: {
        baseConfig: UserConfig;
        configModifier: (config: UserConfig) => Promise<UserConfig>;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.baseConfig = baseConfig;
        this.configModifier = configModifier;
    }

    protected override async createServerForRequest(): Promise<CliServer> {
        const modifiedConfig = await this.configModifier(this.baseConfig);
        return createTestServer(modifiedConfig);
    }
}

// Helper to create StreamableHttpRunner with config modification
function createConfigModifyingRunner(
    baseConfig: UserConfig,
    configModifier: (config: UserConfig) => Promise<UserConfig>
): Promise<{
    runner: StreamableHttpRunner<CliServer>;
    getServerAddress: () => string;
}> {
    const logger = new CompositeLogger({ loggers: [] });
    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
        options: {
            idleTimeoutMS: baseConfig.idleTimeoutMs,
            notificationTimeoutMS: baseConfig.notificationTimeoutMs,
        },
        logger,
        metrics: metrics,
    });

    const mcpHttpServer = new ConfigModifyingMCPHttpServer({
        baseConfig,
        configModifier,
        options: {
            http: {
                host: baseConfig.httpHost,
                port: baseConfig.httpPort,
                responseType: baseConfig.httpResponseType,
            },
            session: {
                idleTimeoutMs: baseConfig.idleTimeoutMs,
                notificationTimeoutMs: baseConfig.notificationTimeoutMs,
                externallyManagedSessions: baseConfig.externallyManagedSessions,
            },
        },
        logger,
        metrics: metrics,
        sessionStore,
    });

    const runner = new StreamableHttpRunner<CliServer>({
        logger,
        metrics: metrics,
        mcpHttpServer,
        sessionStore,
    });

    const getServerAddress = (): string => {
        return (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer.serverAddress;
    };

    return Promise.resolve({ runner, getServerAddress });
}

describe("createSessionConfig (via createServerForRequest override)", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;
    let getServerAddress: () => string;

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
        it("should use the modified config from configModifier", async () => {
            const result = await createConfigModifyingRunner(defaultTestConfig, async (config) =>
                Promise.resolve({
                    ...config,
                    apiBaseUrl: "https://test-api.mongodb.com/",
                })
            );
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
            expectDefined(response);
            expect(response.tools).toBeDefined();
            expect(response.tools.length).toBeGreaterThan(0);
        });

        it("should work with the default config", async () => {
            const result = await createConfigModifyingRunner(defaultTestConfig, (config) => Promise.resolve(config));
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
            expectDefined(response);
            expect(response.tools).toBeDefined();
        });
    });

    describe("server integration", () => {
        it("should successfully initialize server with modified config and serve requests", async () => {
            const result = await createConfigModifyingRunner(defaultTestConfig, async (config) => {
                // Simulate async config modification
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                    ...config,
                    readOnly: true, // Enable read-only mode
                };
            });
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
            await client.connect(transport);

            const response = await client.listTools();
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
        it("should propagate errors from configModifier on client connection", async () => {
            const result = await createConfigModifyingRunner(defaultTestConfig, async () => {
                return Promise.reject(new Error("Failed to fetch config"));
            });
            runner = result.runner;
            getServerAddress = result.getServerAddress;
            await runner.start();
            await sleep(100);

            // Error should occur when a client tries to connect
            client = new Client({ name: "test-client", version: "1.0.0" });
            transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));

            await expect(client.connect(transport)).rejects.toThrow();
        });
    });
});
