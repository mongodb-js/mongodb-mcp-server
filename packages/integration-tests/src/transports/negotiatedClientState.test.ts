import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { StreamableHttpRunner, MCPHttpServer } from "@mongodb-js/mcp-http-runners";
import { type ISessionStore } from "@mongodb-js/mcp-core";
import { SessionStore, CompositeLogger, Keychain, NoopTelemetry } from "@mongodb-js/mcp-core";
import type { NegotiatedClientState, SessionCloseReason } from "@mongodb-js/mcp-types";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import { ToolBase } from "@mongodb-js/mcp-core";
import type { OperationType, ToolCategory } from "@mongodb-js/mcp-types";
import type { TelemetryToolMetadata } from "@mongodb-js/mcp-atlas-telemetry";
import type { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
import type { UserConfig } from "mongodb-mcp-server";
import { CliServer, Elicitation, connectionErrorHandler, packageInfo } from "mongodb-mcp-server";
import { defaultTestConfig } from "../integrationHelpers.js";
import { createTestApiClient } from "../integrationHelpers.js";
import { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
import { ExportsManager, MCPConnectionStore, type DeviceId } from "@mongodb-js/mcp-tools-mongodb";
import { Session } from "@mongodb-js/mcp-cli";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";

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

// Creates a full CliServer instance carrying a ConfirmRequiredTool, modeled on
// the metrics test's createTestServer.
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

    const connectionRegistry = new MCPConnectionStore({
        userConfig: config,
        logger,
        deviceId: {} as unknown as DeviceId,
    }).view();

    const apiClient = createTestApiClient({
        baseUrl: config.apiBaseUrl,
        serverMetadata: packageInfo,
        logger,
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
    });

    vi.spyOn(apiClient, "validateAuthConfig").mockResolvedValue(undefined);
    vi.spyOn(apiClient, "close").mockResolvedValue(undefined);

    const atlasLocalClient = await createAtlasLocalClient({ logger });

    const mcpServer = new McpServer({
        name: "test-server",
        version: packageInfo.version,
    });

    const elicitation = new Elicitation({ server: mcpServer.server, timeoutMs: config.elicitationTimeoutMs });

    const session = new Session({
        logger,
        exportsManager,
        connectionRegistry,
        keychain,
        apiClient,
        connectionErrorHandler,
        atlasLocalClient,
        config,
        userConfig: config,
    });

    const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

    return new CliServer({
        session,
        userConfig: config,
        mcpServer,
        telemetry: new NoopTelemetry() as unknown as AtlasTelemetry,
        connectionErrorHandler,
        elicitation,
        metrics,
        tools: [ConfirmRequiredTool],
        serverMetadata: {
            mcpServerName: "test-server",
            version: "1.0",
            engines: {
                node: "20.0.0",
            },
        },
    });
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

        const logger = new CompositeLogger({ loggers: [] });
        const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

        const innerStore = new SessionStore<StreamableHTTPServerTransport>({
            options: {
                idleTimeoutMS: userConfig.idleTimeoutMs,
                notificationTimeoutMS: userConfig.notificationTimeoutMs,
                maxSessions: userConfig.maxSessions,
            },
            logger,
            metrics,
        });
        sessionStore = new DurableClientStateSessionStore(innerStore);

        // A fresh CliServer per request/session: each session gets its own SDK
        // Server bound to its own transport. A single shared server cannot
        // serve a second (re-initialized) session because the SDK Server binds
        // to exactly one transport.
        class PerRequestMCPHttpServer extends MCPHttpServer<CliServer> {
            protected override async createServerForRequest(): Promise<CliServer> {
                return createTestServer(userConfig);
            }
        }

        const mcpHttpServer = new PerRequestMCPHttpServer({
            options: {
                http: {
                    host: userConfig.httpHost,
                    port: userConfig.httpPort,
                    responseType: userConfig.httpResponseType,
                },
                session: {
                    idleTimeoutMs: userConfig.idleTimeoutMs,
                    notificationTimeoutMs: userConfig.notificationTimeoutMs,
                    externallyManagedSessions: userConfig.externallyManagedSessions,
                },
            },
            logger,
            metrics,
            sessionStore: sessionStore as unknown as SessionStore<StreamableHTTPServerTransport>,
        });

        runner = new StreamableHttpRunner({
            logger,
            mcpHttpServer,
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

        const serverAddress = (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer
            .serverAddress;
        const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`), {
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
        const serverAddress = (runner as unknown as { mcpHttpServer: { serverAddress: string } }).mcpHttpServer
            .serverAddress;
        const transport = new StreamableHTTPClientTransport(new URL(`${serverAddress}/mcp`), {
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
