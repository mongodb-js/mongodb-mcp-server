import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defaultTestConfig } from "./integrationHelpers.js";
import { parsePrometheusValue } from "./metricsHelpers.js";
import type { UserConfig } from "mongodb-mcp-server";
import type { OperationType, ToolCategory } from "@mongodb-js/mcp-core";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata, AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
    Counter,
} from "@mongodb-js/mcp-metrics";
import type { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { EchoTool, ErrorTool, NoopTool } from "./mocks/tools.js";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type {
    IMetrics,
    DefaultMetricDefinitions,
    HttpServerOptions,
    SessionManagementOptions,
} from "@mongodb-js/mcp-types";
import { Server, type AnyToolClass, Session, Elicitation, connectionErrorHandler } from "mongodb-mcp-server";
import { MCPConnectionManager, ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
import { StreamableHttpRunner, MonitoringServer, MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import { SessionStore } from "@mongodb-js/mcp-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { packageInfo } from "mongodb-mcp-server";

// Helper to create a full Server instance for tests
async function createTestServer(
    config: UserConfig,
    options: {
        tools?: AnyToolClass[];
        metrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    } = {}
): Promise<Server> {
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

    const apiClient = new ApiClient({
        baseUrl: config.apiBaseUrl,
        userAgent: `mongodb-mcp-server/${packageInfo.version}`,
        logger,
        credentials: {
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
        },
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

    const metrics = options.metrics ?? new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const server = new Server({
        session,
        userConfig: config,
        mcpServer,
        telemetry: {
            emitEvents: () => Promise.resolve(),
            close: () => Promise.resolve(),
            isTelemetryEnabled: () => false,
        } as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        tools: options.tools,
    });

    return server;
}

// Custom MCPHttpServer that creates test servers with custom tools/metrics
class TestMCPHttpServer extends MCPHttpServer<Server, DefaultMetricDefinitions> {
    private userConfig: UserConfig;
    private tools?: AnyToolClass[];
    private customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;

    constructor({
        userConfig,
        options,
        logger,
        metrics,
        sessionStore,
        tools,
        customMetrics,
    }: {
        userConfig: UserConfig;
        options: {
            http: HttpServerOptions;
            session: SessionManagementOptions;
        };
        logger: CompositeLogger;
        metrics: IMetrics<DefaultMetricDefinitions>;
        sessionStore: SessionStore<StreamableHTTPServerTransport>;
        tools?: AnyToolClass[];
        customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    }) {
        super({ options, logger, metrics, sessionStore });
        this.userConfig = userConfig;
        this.tools = tools;
        this.customMetrics = customMetrics;
    }

    protected override async createServerForRequest(): Promise<Server> {
        return createTestServer(this.userConfig, {
            tools: this.tools,
            metrics:
                this.customMetrics ??
                (this.metrics as unknown as PrometheusMetrics<DefaultPrometheusMetricDefinitions>),
        });
    }
}

// Helper to create StreamableHttpRunner with all components
function createMetricsTestRunner(
    config: UserConfig,
    options: {
        tools?: AnyToolClass[];
        customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    } = {}
): {
    runner: StreamableHttpRunner<Server>;
    monitoringServer: MonitoringServer;
    getServerAddress: () => string;
} {
    const logger = new CompositeLogger({ loggers: [] });
    const metrics = options.customMetrics ?? new PrometheusMetrics({ definitions: createDefaultMetrics() });

    const sessionStore = new SessionStore<StreamableHTTPServerTransport>({
        options: {
            idleTimeoutMS: config.idleTimeoutMs,
            notificationTimeoutMS: config.notificationTimeoutMs,
        },
        logger,
        metrics: metrics,
    });

    const mcpHttpServer = new TestMCPHttpServer({
        userConfig: config,
        options: {
            http: {
                host: config.httpHost,
                port: config.httpPort,
                responseType: config.httpResponseType,
            },
            session: {
                idleTimeoutMs: config.idleTimeoutMs,
                notificationTimeoutMs: config.notificationTimeoutMs,
                externallyManagedSessions: config.externallyManagedSessions,
            },
        },
        logger,
        metrics: metrics,
        sessionStore,
        tools: options.tools,
        customMetrics: options.customMetrics,
    });

    const monitoringServer = new MonitoringServer({
        options: {
            http: {
                host: config.monitoringServerHost!,
                port: config.monitoringServerPort!,
            },
            features: config.monitoringServerFeatures,
        },
        logger,
        metrics: metrics,
    });

    const runner = new StreamableHttpRunner<Server>({
        logger,
        metrics: metrics,
        mcpHttpServer,
        monitoringServer,
        sessionStore,
    });

    const getServerAddress = (): string => {
        return (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer.serverAddress;
    };

    return { runner, monitoringServer, getServerAddress };
}

describe("/metrics endpoint", () => {
    let runner: StreamableHttpRunner<Server>;
    let monitoringServer: MonitoringServer;
    let getServerAddress: () => string;
    let config: UserConfig;
    let clients: Client[] = [];

    const connectClient = async (): Promise<Client> => {
        const client = new Client({ name: "test", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress()}/mcp`));
        await client.connect(transport);
        clients.push(client);
        return client;
    };

    beforeEach(() => {
        config = {
            ...defaultTestConfig,
            httpPort: 0,
            transport: "http",
            monitoringServerPort: 0,
            monitoringServerHost: "127.0.0.1",
            monitoringServerFeatures: ["health-check", "metrics"],
        };
    });

    afterEach(async () => {
        for (const client of clients) {
            await client.close();
        }
        clients = [];
        await runner?.close();
        runner = undefined as unknown as StreamableHttpRunner<Server>;
    });

    const monitoringUrl = (path: string): string => `${monitoringServer.serverAddress}${path}`;

    it("reflects built-in tool execution metrics after tool calls", async () => {
        const result = createMetricsTestRunner(config, { tools: [EchoTool] });
        runner = result.runner;
        monitoringServer = result.monitoringServer;
        getServerAddress = result.getServerAddress;
        await runner.start();

        const client = await connectClient();
        await client.callTool({ name: "echo-tool", arguments: {} });
        await client.callTool({ name: "echo-tool", arguments: {} });

        const body = await (await fetch(monitoringUrl("/metrics"))).text();
        console.log("BODY:", body);

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_count", {
                tool_name: "echo-tool",
                category: "mongodb",
                status: "success",
                operation_type: "read",
            })
        ).toBe(2);

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_sum", {
                tool_name: "echo-tool",
                category: "mongodb",
                status: "success",
                operation_type: "read",
            })
        ).toBeGreaterThanOrEqual(0);
    });

    it("records error_type label on toolExecutionDuration histogram when a tool throws", async () => {
        const result = createMetricsTestRunner(config, { tools: [ErrorTool] });
        runner = result.runner;
        monitoringServer = result.monitoringServer;
        getServerAddress = result.getServerAddress;
        await runner.start();

        const client = await connectClient();
        await client.callTool({ name: "error-tool", arguments: {} });

        const body = await (await fetch(monitoringUrl("/metrics"))).text();

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_count", {
                tool_name: "error-tool",
                status: "error",
                operation_type: "read",
                error_type: "TypeError",
            })
        ).toBe(1);
    });

    it("increments mcp_session_created when clients connect", async () => {
        const result = createMetricsTestRunner(config, { tools: [NoopTool] });
        runner = result.runner;
        monitoringServer = result.monitoringServer;
        getServerAddress = result.getServerAddress;
        await runner.start();

        await connectClient();
        await connectClient();

        const body = await (await fetch(monitoringUrl("/metrics"))).text();
        expect(parsePrometheusValue(body, "mcp_session_created", {})).toBe(2);
    });

    it("increments mcp_session_closed with reason when sessions close", async () => {
        const result = createMetricsTestRunner(config, { tools: [NoopTool] });
        runner = result.runner;
        monitoringServer = result.monitoringServer;
        getServerAddress = result.getServerAddress;
        await runner.start();

        await connectClient();
        await connectClient();

        type SessionStoreAccessor = { sessionStore: { closeAllSessions(): Promise<void> } };
        await (runner as unknown as SessionStoreAccessor).sessionStore.closeAllSessions();

        const body = await (await fetch(monitoringUrl("/metrics"))).text();
        expect(parsePrometheusValue(body, "mcp_session_created", {})).toBe(2);
        expect(parsePrometheusValue(body, "mcp_session_closed", { reason: "server_stop" })).toBe(2);
    });

    it("exposes custom metrics in /metrics output", async () => {
        type CustomMetrics = DefaultPrometheusMetricDefinitions & { callCount: Counter<"tool_name"> };

        const customMetrics = new PrometheusMetrics({
            definitions: {
                ...createDefaultMetrics(),
                callCount: new Counter({
                    name: "custom_tool_call_count",
                    help: "Counts how many times the custom tool was invoked",
                    labelNames: ["tool_name"] as const,
                    registers: [],
                }),
            } satisfies CustomMetrics,
        });

        class CustomTool extends ToolBase<UserConfig, CustomMetrics> {
            static toolName = "custom-tool";
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "read";
            public description = "Custom tool that increments a user-supplied counter";
            public argsShape = {};
            protected execute(): Promise<CallToolResult> {
                this.metrics.get("callCount").inc({ tool_name: "custom-tool" });
                return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
            }
            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        const result = createMetricsTestRunner(config, {
            tools: [CustomTool as AnyToolClass],
            customMetrics,
        });
        runner = result.runner;
        monitoringServer = result.monitoringServer;
        getServerAddress = result.getServerAddress;

        await runner.start();

        const client = await connectClient();
        await client.callTool({ name: "custom-tool", arguments: {} });
        await client.callTool({ name: "custom-tool", arguments: {} });
        await client.callTool({ name: "custom-tool", arguments: {} });

        const body = await fetch(monitoringUrl("/metrics")).then((r) => r.text());

        // Custom counter is registered in the runner's registry and appears in the scrape
        expect(parsePrometheusValue(body, "custom_tool_call_count", { tool_name: "custom-tool" })).toBe(3);

        // Built-in metrics are still present alongside custom ones
        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_count", {
                tool_name: "custom-tool",
                category: "mongodb",
                status: "success",
                operation_type: "read",
            })
        ).toBe(3);
    });
});
