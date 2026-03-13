import { StreamableHttpRunner } from "../../src/transports/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { defaultTestConfig } from "./helpers.js";
import { parsePrometheusValue } from "./metricsHelpers.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import type { OperationType, ToolCategory } from "../../src/tools/tool.js";
import { ToolBase } from "../../src/tools/tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata } from "../../src/telemetry/types.js";
import { Counter } from "prom-client";
import type { MetricDefinitions } from "../../src/common/metrics/metricsTypes.js";
import type { DefaultMetrics } from "../../src/common/metrics/metricDefinitions.js";

describe("/metrics endpoint", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let runner: StreamableHttpRunner<UserConfig, any>;
    let config: UserConfig;
    let clients: Client[] = [];

    const connectClient = async (): Promise<Client> => {
        const client = new Client({ name: "test", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`));
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
        runner = undefined as unknown as StreamableHttpRunner;
    });

    const monitoringUrl = (path: string): string => `${runner["monitoringServer"]!.serverAddress}${path}`;

    it("reflects built-in tool execution metrics after tool calls", async () => {
        class EchoTool extends ToolBase {
            static toolName = "echo-tool";
            static category: ToolCategory = "mongodb";
            static operationType: OperationType = "read";
            public description = "Returns a static response";
            public argsShape = {};
            protected execute(): Promise<CallToolResult> {
                return Promise.resolve({ content: [{ type: "text", text: "ok" }] });
            }
            protected resolveTelemetryMetadata(): TelemetryToolMetadata {
                return {};
            }
        }

        runner = new StreamableHttpRunner({ userConfig: config, tools: [EchoTool] });
        await runner.start();

        const client = await connectClient();
        await client.callTool({ name: "echo-tool", arguments: {} });
        await client.callTool({ name: "echo-tool", arguments: {} });

        const body = await fetch(monitoringUrl("/metrics")).then((r) => r.text());

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_total", {
                tool_name: "echo-tool",
                category: "mongodb",
                status: "success",
            })
        ).toBe(2);

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_count", {
                tool_name: "echo-tool",
                category: "mongodb",
            })
        ).toBe(2);

        expect(
            parsePrometheusValue(body, "mcp_tool_execution_duration_seconds_sum", {
                tool_name: "echo-tool",
                category: "mongodb",
            })
        ).toBeGreaterThanOrEqual(0);
    });

    it("exposes additionalMetrics in /metrics output", async () => {
        const additionalMetrics = {
            callCount: new Counter({
                name: "custom_tool_call_count",
                help: "Counts how many times the custom tool was invoked",
                labelNames: ["tool_name"] as const,
                registers: [],
            }),
        } satisfies MetricDefinitions;
        type CustomMetrics = typeof additionalMetrics & DefaultMetrics;

        class CustomTool extends ToolBase<UserConfig, unknown, CustomMetrics> {
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

        runner = new StreamableHttpRunner({
            userConfig: config,
            tools: [CustomTool],
            additionalMetrics,
        });
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
            parsePrometheusValue(body, "mcp_tool_execution_total", {
                tool_name: "custom-tool",
                category: "mongodb",
                status: "success",
            })
        ).toBe(3);
    });
});
