import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { StreamableHttpRunner } from "../../../src/transports/streamableHttp.js";
import {
    createDefaultSessionStore,
    type ISessionStore,
    type NegotiatedClientState,
    type SessionCloseReason,
} from "../../../src/common/sessionStore.js";
import type { LoggerBase } from "../../../src/common/logging/index.js";
import type { Session } from "../../../src/common/session.js";
import type { OperationType, ToolCategory } from "../../../src/tools/tool.js";
import { ToolBase } from "../../../src/tools/tool.js";
import type { TelemetryToolMetadata } from "../../../src/telemetry/types.js";
import type { UserConfig } from "../../../src/common/config/userConfig.js";
import { defaultTestConfig } from "../helpers.js";

/**
 * Session store that keeps transports in memory (like the default store) but
 * persists the negotiated client state in a separate "durable" map that
 * survives session eviction — modeling what a deployment with a durable
 * session database (e.g. the Atlas remote MCP server) implements.
 */
class DurableClientStateSessionStore implements ISessionStore<StreamableHTTPServerTransport> {
    public readonly durableClientState = new Map<string, NegotiatedClientState>();

    constructor(private readonly inner: ISessionStore<StreamableHTTPServerTransport>) {}

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
    let runner: StreamableHttpRunner;
    let sessionStore: DurableClientStateSessionStore;
    let client: Client | undefined;

    beforeEach(async () => {
        const userConfig: UserConfig = {
            ...defaultTestConfig,
            httpPort: 0,
            externallyManagedSessions: true,
            confirmationRequiredTools: ["confirm-required-tool"],
        };
        runner = new StreamableHttpRunner({
            userConfig,
            tools: [ConfirmRequiredTool],
            createSessionStore: (args): ISessionStore<StreamableHTTPServerTransport> => {
                sessionStore = new DurableClientStateSessionStore(
                    createDefaultSessionStore<StreamableHTTPServerTransport>(args)
                );
                return sessionStore;
            },
        });
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

        const transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`), {
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
        const transport = new StreamableHTTPClientTransport(new URL(`${runner["mcpServer"]!.serverAddress}/mcp`), {
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
