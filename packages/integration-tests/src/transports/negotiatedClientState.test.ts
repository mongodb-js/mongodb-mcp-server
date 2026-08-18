import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { StreamableHttpRunner } from "@mongodb-js/mcp-http-runners";
import { type ISessionStore } from "@mongodb-js/mcp-core";
import { SessionStore, CompositeLogger, ToolBase } from "@mongodb-js/mcp-core";
import type { NegotiatedClientState, SessionCloseReason } from "@mongodb-js/mcp-types";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import type { OperationType, ToolCategory } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import type { UserConfig } from "mongodb-mcp-server";
import type { CliServer } from "mongodb-mcp-server";
import { Session } from "@mongodb-js/mcp-cli";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import { defaultTestConfig } from "../integrationHelpers.js";
import { createStreamableHttpTestRunner, getServerAddress } from "../helpers/streamableHttpTestRunner.js";

/**
 * Session store that keeps transports in memory (like the default store) but
 * persists the negotiated client state in a separate "durable" map that
 * survives session eviction — modeling what a deployment with a durable
 * session database (e.g. the Atlas remote MCP server) implements.
 */
class DurableClientStateSessionStore implements ISessionStore<StreamableHTTPServerTransport> {
    public readonly durableClientState = new Map<string, NegotiatedClientState>();

    private readonly inner: ISessionStore<StreamableHTTPServerTransport>;

    constructor(inner: ISessionStore<StreamableHTTPServerTransport>) {
        this.inner = inner;
    }

    getSession(
        sessionId: string,
        headers?: Record<string, unknown>
    ): Promise<StreamableHTTPServerTransport | undefined> {
        return this.inner.getSession(sessionId, headers);
    }

    addSession(params: {
        sessionId: string;
        transport: StreamableHTTPServerTransport;
        logger: LoggerBase;
        session: Session;
        headers?: Record<string, unknown>;
    }): Promise<void> {
        return this.inner.addSession(params);
    }

    closeSession(params: { sessionId: string; reason?: SessionCloseReason }): Promise<void> {
        return this.inner.closeSession(params);
    }

    closeAllSessions(): Promise<void> {
        return this.inner.closeAllSessions();
    }

    saveNegotiatedClientState(sessionId: string, state: NegotiatedClientState): Promise<void> {
        this.durableClientState.set(sessionId, state);
        return Promise.resolve();
    }

    loadNegotiatedClientState(sessionId: string): Promise<NegotiatedClientState | undefined> {
        return Promise.resolve(this.durableClientState.get(sessionId));
    }
}

class ConfirmRequiredTool extends ToolBase {
    static toolName = "confirm-required-tool";
    public description = "Tool that requires confirmation before executing";
    public argsShape = {};
    static category: ToolCategory = "mongodb";
    static operationType: OperationType = "delete";

    protected execute(): Promise<CallToolResult> {
        return Promise.resolve({ content: [{ type: "text", text: "Tool executed" }] });
    }

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {};
    }
}

describe("negotiated client state across implicit session re-initialization", () => {
    let runner: StreamableHttpRunner<CliServer>;
    let sessionStore: DurableClientStateSessionStore;
    let client: Client | undefined;

    beforeEach(async () => {
        const userConfig: UserConfig = {
            ...defaultTestConfig,
            httpPort: 0,
            externallyManagedSessions: true,
            confirmationRequiredTools: ["confirm-required-tool"],
        };

        const innerStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: userConfig.idleTimeoutMs,
                notificationTimeoutMS: userConfig.notificationTimeoutMs,
                maxSessions: userConfig.maxSessions,
            },
            logger: new CompositeLogger({ loggers: [] }),
            metrics: new PrometheusMetrics({ definitions: createDefaultMetrics() }),
        });
        sessionStore = new DurableClientStateSessionStore(innerStore);

        // The runner creates a fresh CliServer per request/session via the
        // shared helper: each session gets its own SDK Server bound to its own
        // transport. A single shared server cannot serve a second
        // (re-initialized) session because the SDK Server binds to exactly one
        // transport.
        ({ runner } = createStreamableHttpTestRunner(userConfig, {
            tools: [ConfirmRequiredTool],
            sessionStore,
        }));

        await runner.start();
    });

    afterEach(async () => {
        await client?.close();
        client = undefined;
        await runner.close();
    });

    it("re-elicits confirmation after the session is implicitly re-initialized", async () => {
        const sessionId = "restored-session";
        const elicitationMessages: string[] = [];

        client = new Client({ name: "elicit-client", version: "1.0.0" }, { capabilities: { elicitation: {} } });
        client.setRequestHandler(ElicitRequestSchema, (request) => {
            elicitationMessages.push(request.params.message);
            return { action: "accept" as const, content: { confirmation: "Yes" } };
        });

        const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {
            requestInit: { headers: { "mcp-session-id": sessionId } },
        });
        await client.connect(transport);

        // Baseline: a freshly initialized session elicits confirmation.
        const firstResult = (await client.callTool({ name: "confirm-required-tool", arguments: {} }, undefined, {
            timeout: 10_000,
        })) as CallToolResult;
        expect(elicitationMessages).toHaveLength(1);
        expect(firstResult.isError).toBeFalsy();

        // Evict the in-memory session while the durable state survives — as
        // happens after an idle timeout, LRU eviction, or a pod
        // restart/switch in a multi-pod deployment.
        await sessionStore.closeSession({ sessionId, reason: "idle_timeout" });

        // The next call takes the implicit re-initialization path. The
        // restored server must still know the client supports elicitation
        // and ask for confirmation rather than silently executing.
        const secondResult = (await client.callTool({ name: "confirm-required-tool", arguments: {} }, undefined, {
            timeout: 10_000,
        })) as CallToolResult;
        expect(elicitationMessages).toHaveLength(2);
        expect(secondResult.isError).toBeFalsy();
        expect(secondResult.content).toEqual([{ type: "text", text: "Tool executed" }]);
    });

    it("persists the negotiated client state when the session initializes", async () => {
        const sessionId = "persisted-session";

        client = new Client({ name: "state-client", version: "2.3.4" }, { capabilities: { elicitation: {} } });
        const transport = new StreamableHTTPClientTransport(new URL(`${getServerAddress(runner)}/mcp`), {
            requestInit: { headers: { "mcp-session-id": sessionId } },
        });
        await client.connect(transport);

        const state = sessionStore.durableClientState.get(sessionId);
        expect(state).toBeDefined();
        // The client SDK normalizes the declared elicitation capability
        // (e.g. `{}` becomes `{ form: {} }`), so only assert its presence.
        expect(state?.clientCapabilities?.elicitation).toBeDefined();
        expect(state?.clientInfo).toMatchObject({ name: "state-client", version: "2.3.4" });
    });
});
