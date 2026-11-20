import type { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, afterEach } from "vitest";
import { defaultTestConfig } from "../integrationHelpers.js";
import {
    type OperationType,
    type ToolArgs,
    type ToolCategory,
    type ToolExecutionContext,
    ToolBase,
    type CliServer,
} from "mongodb-mcp-server";
import type { CallToolResult } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import { createStreamableHttpTestRunner, getServerAddress } from "../helpers/streamableHttpTestRunner.js";

type ToolOutcome = { aborted: boolean; reason?: unknown };

/**
 * A tool that stays in flight until its request signal aborts (or a safety
 * timeout elapses), recording what happened so tests can assert on it.
 */
function createBlockingTool(): {
    BlockingTool: typeof ToolBase;
    started: Promise<void>;
    outcome: Promise<ToolOutcome>;
} {
    let markStarted: () => void = () => {};
    let settle: (outcome: ToolOutcome) => void = () => {};
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const outcome = new Promise<ToolOutcome>((resolve) => (settle = resolve));

    class BlockingTool extends ToolBase {
        static toolName = "blocking-tool";
        public description = "Blocks until the request is cancelled";
        public argsShape(): Record<string, never> {
            return {};
        }
        static category: ToolCategory = "mongodb";
        static operationType: OperationType = "read";
        protected async execute(
            _: ToolArgs<ReturnType<typeof this.argsShape>>,
            { request }: ToolExecutionContext
        ): Promise<CallToolResult> {
            markStarted();
            const aborted = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => resolve(false), 3_000);
                request.signal.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        resolve(true);
                    },
                    { once: true }
                );
            });
            settle({ aborted, reason: aborted ? (request.signal.reason as unknown) : undefined });
            return { content: [{ type: "text", text: aborted ? "aborted" : "finished" }] };
        }
        protected resolveTelemetryMetadata(): TelemetryToolMetadata {
            return {};
        }
    }

    return { BlockingTool: BlockingTool as unknown as typeof ToolBase, started, outcome };
}

describe("2025-era HTTP request cancellation on client disconnect", () => {
    let runner: StreamableHttpRunner<CliServer> | undefined;
    let client: Client | undefined;

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await runner?.close();
        runner = undefined;
    });

    const startServer = async ({
        responseType,
    }: {
        responseType: "sse" | "json";
    }): Promise<{
        started: Promise<void>;
        outcome: Promise<ToolOutcome>;
        transport: StreamableHTTPClientTransport;
    }> => {
        const { BlockingTool, started, outcome } = createBlockingTool();
        runner = createStreamableHttpTestRunner(
            { ...defaultTestConfig, httpPort: 0, httpResponseType: responseType },
            { tools: [BlockingTool as never] }
        ).runner;
        await runner.start();

        const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`));
        client = new Client({ name: "cancellation-test", version: "0.0.0" });
        await client.connect(transport);
        return { started, outcome, transport };
    };

    /** Sends a `tools/call` on the client's session with a raw fetch the test can abort mid-flight. */
    const postToolCall = ({
        transport,
        signal,
    }: {
        transport: StreamableHTTPClientTransport;
        signal: AbortSignal;
    }): Promise<unknown> => {
        if (!runner || !transport.sessionId || !transport.protocolVersion) {
            throw new Error("The client must be connected before sending a raw request");
        }
        return fetch(`${getServerAddress(runner)}/mcp`, {
            method: "POST",
            signal,
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                "mcp-session-id": transport.sessionId,
                "mcp-protocol-version": transport.protocolVersion,
            },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: "disconnect-me",
                method: "tools/call",
                params: { name: "blocking-tool", arguments: {} },
            }),
        }).then(
            // Drain the body so an abort while streaming surfaces here rather
            // than as an unhandled rejection.
            (response) => response.text().catch(() => undefined),
            () => undefined
        );
    };

    for (const responseType of ["sse", "json"] as const) {
        it(`aborts the tool's request signal when the client disconnects (${responseType} responses)`, async () => {
            const { started, outcome, transport } = await startServer({ responseType });
            const controller = new AbortController();
            const pending = postToolCall({ transport, signal: controller.signal });

            await started;
            controller.abort();

            const { aborted, reason } = await outcome;
            expect(aborted).toBe(true);
            expect(String(reason)).toContain("Client disconnected before the response was sent");
            await pending;

            // The session survives the disconnect and keeps serving requests.
            expect((await client?.listTools())?.tools.map((tool) => tool.name)).toEqual(["blocking-tool"]);
        });
    }

    it("does not cancel a request that completed before the connection closed", async () => {
        const { outcome } = await startServer({ responseType: "sse" });

        const result = (await client?.callTool({ name: "blocking-tool", arguments: {} })) as CallToolResult;

        expect(await outcome).toEqual({ aborted: false, reason: undefined });
        expect(result.content).toEqual([{ type: "text", text: "finished" }]);
    });
});
