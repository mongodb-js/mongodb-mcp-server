import { describe, expect, it } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ToolBase, type ToolArgs } from "@mongodb-js/mcp-core";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import type {
    CallToolResult,
    DefaultMetricDefinitions,
    OperationType,
    ToolCategory,
    ToolExecutionContext,
} from "@mongodb-js/mcp-types";
import type { CliServer, UserConfig } from "mongodb-mcp-server";
import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { defaultTestConfig } from "../integrationHelpers.js";
import { createStreamableHttpTestRunner } from "../helpers/streamableHttpTestRunner.js";

/**
 * Test-only tool that reflects the MCP client identity the server saw for the
 * request. It exposes `request.clientInfo` verbatim so a test can assert that
 * the client name/version actually propagated through the modern 2026-07-28
 * per-request envelope path (and the legacy 2025-era negotiate path).
 */
class ClientInfoReflectTool extends ToolBase<CliServer, DefaultMetricDefinitions> {
    static toolName = "client-info-reflect";
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "metadata";
    public description = "Reflects the client identity the server observed for this request";
    public argsShape(): Record<string, never> {
        return {};
    }

    protected execute(_: ToolArgs<Record<string, never>>, { request }: ToolExecutionContext): Promise<CallToolResult> {
        return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify(request.clientInfo) }],
        });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

describe("clientInfo propagates to tools", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let config: UserConfig;

    const startRunner = async (): Promise<string> => {
        config = { ...defaultTestConfig, httpPort: 0, httpResponseType: "json" };
        const { runner: r, getServerAddress: addr } = createStreamableHttpTestRunner(config, {
            tools: [ClientInfoReflectTool],
            enableMonitoringServer: false,
        });
        runner = r;
        await runner.start();
        return addr();
    };

    const connectClient = async (serverAddress: string): Promise<Client> => {
        const client = new Client({ name: "client-info-e2e", version: "1.2.3" });
        const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`));
        await client.connect(transport);
        return client;
    };

    it("carries the client name/version to the tool over the modern (2026-07-28) HTTP path", async () => {
        const serverAddress = await startRunner();
        const client = await connectClient(serverAddress);
        try {
            const result = (await client.callTool({ name: "client-info-reflect", arguments: {} })) as {
                content: { text: string }[];
            };
            const reflected = JSON.parse(result.content[0]?.text ?? "null") as { name?: string; version?: string };
            expect(reflected.name).toBe("client-info-e2e");
            expect(reflected.version).toBe("1.2.3");
        } finally {
            await client.close();
        }
    });

    it("carries the client name/version to the tool over the legacy (2025-era) sessionful path", async () => {
        const serverAddress = await startRunner();

        // 1) Legacy initialize (2024-11-05) declaratively carries clientInfo. The
        // legacy path is sessionful: this returns a session id we reuse below.
        const initRes = await fetch(`${serverAddress}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", accept: "application/json, text/event-stream" },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "initialize",
                id: 1,
                params: {
                    protocolVersion: "2024-11-05",
                    capabilities: {},
                    clientInfo: { name: "client-info-legacy", version: "4.5.6" },
                },
            }),
        });
        const sessionId = initRes.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();

        // 2) tools/call on the same session.
        const callRes = await fetch(`${serverAddress}/mcp`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-session-id": sessionId as string,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: "tools/call",
                id: 2,
                params: { name: "client-info-reflect", arguments: {} },
            }),
        });
        const callBody = (await callRes.json()) as { result?: { content: { text: string }[] } };
        const reflected = JSON.parse(callBody.result?.content?.[0]?.text ?? "null") as {
            name?: string;
            version?: string;
        };
        expect(reflected.name).toBe("client-info-legacy");
        expect(reflected.version).toBe("4.5.6");
    });
});
