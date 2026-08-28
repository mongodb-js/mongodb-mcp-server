import type { StreamableHttpRunner, MonitoringServer } from "@mongodb-js/mcp-http-runners";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { defaultTestConfig } from "./integrationHelpers.js";
import { parsePrometheusValue } from "./metricsHelpers.js";
import type { UserConfig } from "mongodb-mcp-server";
import type { OperationType, ToolCategory } from "@mongodb-js/mcp-types";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { CallToolResult, ISession, IToolConfig } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
    Counter,
} from "@mongodb-js/mcp-metrics";
import { EchoTool, ErrorTool, NoopTool } from "./mocks/tools.js";
import { createStreamableHttpTestRunner } from "./helpers/streamableHttpTestRunner.js";
import type { AnyToolClass } from "@mongodb-js/mcp-core";
import type { CliServer } from "mongodb-mcp-server";

// Helper to create StreamableHttpRunner with all components
function createMetricsTestRunner(
    config: UserConfig,
    options: {
        tools?: AnyToolClass[];
        customMetrics?: PrometheusMetrics<DefaultPrometheusMetricDefinitions>;
    } = {}
): {
    runner: StreamableHttpRunner<CliServer>;
    monitoringServer: MonitoringServer;
    getServerAddress: () => string;
} {
    const components = createStreamableHttpTestRunner(config, options);
    return {
        ...components,
        // The metrics test config always enables the monitoring server.
        monitoringServer: components.monitoringServer as MonitoringServer,
    };
}

describe("/metrics endpoint", () => {
    let runner: StreamableHttpRunner<CliServer>;
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
        runner = undefined as unknown as StreamableHttpRunner<CliServer>;
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

        type SessionStoreAccessor = { mcpHttpServer: { sessionStore: { closeAllSessions(): Promise<void> } } };
        await (runner as unknown as SessionStoreAccessor).mcpHttpServer.sessionStore.closeAllSessions();

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

        class CustomTool extends ToolBase<ISession<IToolConfig>, CustomMetrics> {
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
