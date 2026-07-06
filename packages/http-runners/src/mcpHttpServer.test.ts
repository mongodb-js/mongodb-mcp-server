import { describe, it, expect, afterEach, vi } from "vitest";
import { MCPHttpServer } from "./mcpHttpServer.js";
import { SessionRejectedError, LoggerBase, Keychain } from "@mongodb-js/mcp-core";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type {
    DefaultMetricDefinitions,
    IMetrics,
    ICompositeLogger,
    ISessionStore,
    SessionServer,
    TransportRequestContext,
    HttpServerOptions,
    SessionManagementOptions,
    LogLevel,
    LogPayload,
    LoggerType,
    ILogger,
} from "@mongodb-js/mcp-types";
import type { DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

class MockMetrics
    extends PrometheusMetrics<DefaultPrometheusMetricDefinitions>
    implements IMetrics<DefaultMetricDefinitions>
{
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}

class InMemoryLogger extends LoggerBase implements ICompositeLogger {
    protected type: LoggerType = "console";
    public messages: { level: LogLevel; payload: LogPayload }[] = [];
    public attributes: Record<string, string> = {};

    constructor() {
        super({ keychain: Keychain.root });
    }

    protected logCore(level: LogLevel, payload: LogPayload): void {
        this.messages.push({ level, payload });
    }

    public setAttribute(key: string, value: string): void {
        this.attributes[key] = value;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public addLogger(_: ILogger): void {
        // No-op for testing
    }
}

const INIT_BODY = JSON.stringify({
    jsonrpc: "2.0",
    method: "initialize",
    id: 1,
    params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
    },
});

const NON_INIT_BODY = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 });

const httpOptions: HttpServerOptions = {
    host: "127.0.0.1",
    port: 0,
    responseType: "json",
};

const sessionOptions: SessionManagementOptions = {
    idleTimeoutMs: 30_000,
    notificationTimeoutMs: 30_000,
    externallyManagedSessions: false,
};

function makeSessionStore(
    getSessionImpl: (
        sessionId: string,
        headers?: Record<string, unknown>
    ) => Promise<StreamableHTTPServerTransport | null>
): ISessionStore<StreamableHTTPServerTransport> {
    return {
        getSession: vi.fn().mockImplementation(getSessionImpl),
        addSession: vi.fn().mockResolvedValue(undefined),
        closeSession: vi.fn().mockResolvedValue(undefined),
        closeAllSessions: vi.fn().mockResolvedValue(undefined),
    };
}

function makeFakeServer(): SessionServer {
    return {
        session: {
            logger: new InMemoryLogger(),
        },
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    } as unknown as SessionServer;
}

class TestMCPHttpServer extends MCPHttpServer {
    constructor({
        logger,
        sessionStore,
    }: {
        logger: InMemoryLogger;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    }) {
        super({
            options: { http: httpOptions, session: sessionOptions },
            logger,
            metrics: new MockMetrics(),
            sessionStore,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected override createServerForRequest(_: TransportRequestContext): Promise<SessionServer> {
        return Promise.resolve(makeFakeServer());
    }
}

describe("MCPHttpServer x-request-id logging", () => {
    let server: TestMCPHttpServer;
    let logger: InMemoryLogger;

    afterEach(async () => {
        await server?.stop();
    });

    async function startServer(
        sessionStore: ISessionStore<StreamableHTTPServerTransport>,
        createServerForRequest?: () => Promise<SessionServer>
    ): Promise<void> {
        logger = new InMemoryLogger();

        if (createServerForRequest) {
            const createServer = createServerForRequest;
            class CustomTestMCPHttpServer extends TestMCPHttpServer {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                protected override createServerForRequest(_: TransportRequestContext): Promise<SessionServer> {
                    return createServer();
                }
            }
            server = new CustomTestMCPHttpServer({ logger, sessionStore });
        } else {
            server = new TestMCPHttpServer({ logger, sessionStore });
        }

        await server.start();
    }

    async function post(path: string, body: string, headers: Record<string, string>): Promise<Response> {
        return fetch(`${server.serverAddress}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body,
        });
    }

    it("includes x-request-id in debug log when session is not found", async () => {
        await startServer(makeSessionStore(() => Promise.resolve(null)));

        const res = await post("/mcp", NON_INIT_BODY, {
            "mcp-session-id": "sess-abc",
            "x-request-id": "req-not-found",
        });

        expect(res.status).toBe(404);
        const log = logger.messages.find((m) => m.level === "debug" && m.payload.message.includes("not found"));
        expect(log?.payload.attributes).toEqual(expect.objectContaining({ "x-request-id": "req-not-found" }));
    });

    it("omits x-request-id from debug log when header is absent", async () => {
        await startServer(makeSessionStore(() => Promise.resolve(null)));

        await post("/mcp", NON_INIT_BODY, { "mcp-session-id": "sess-abc" });

        const log = logger.messages.find((m) => m.level === "debug" && m.payload.message.includes("not found"));
        expect(log?.payload.attributes?.["x-request-id"]).toBeUndefined();
    });

    it("includes x-request-id in debug log when externallyManagedSessions is disabled", async () => {
        await startServer(makeSessionStore(() => Promise.resolve(null)));

        const res = await post("/mcp", INIT_BODY, {
            "mcp-session-id": "sess-xyz",
            "x-request-id": "req-ext-sessions",
        });

        expect(res.status).toBe(400);
        const log = logger.messages.find(
            (m) => m.level === "debug" && m.payload.message.includes("externallyManagedSessions")
        );
        expect(log?.payload.attributes).toEqual(expect.objectContaining({ "x-request-id": "req-ext-sessions" }));
    });

    it("forwards the incoming request headers to sessionStore.addSession", async () => {
        const addSession = vi.fn().mockResolvedValue(undefined);
        const sessionStore: ISessionStore<StreamableHTTPServerTransport> = {
            ...makeSessionStore(() => Promise.resolve(null)),
            addSession,
        };
        await startServer(sessionStore);

        await post("/mcp", INIT_BODY, {
            "x-request-id": "req-add-session",
        });

        expect(addSession).toHaveBeenCalledTimes(1);
        const call = addSession.mock.calls[0]?.[0] as { headers?: Record<string, unknown> };
        expect(call.headers).toEqual(expect.objectContaining({ "x-request-id": "req-add-session" }));
    });

    it("passes the server session to sessionStore.addSession", async () => {
        const addSession = vi.fn().mockResolvedValue(undefined);
        const sessionStore: ISessionStore<StreamableHTTPServerTransport> = {
            ...makeSessionStore(() => Promise.resolve(null)),
            addSession,
        };
        const fakeServer = makeFakeServer();
        await startServer(sessionStore, () => Promise.resolve(fakeServer));

        await post("/mcp", INIT_BODY, {});

        expect(addSession).toHaveBeenCalledTimes(1);
        const call = addSession.mock.calls[0]?.[0] as { session?: unknown };
        expect(call.session).toBe(fakeServer.session);
    });

    it("responds as session-not-found when sessionStore.getSession throws SessionRejectedError", async () => {
        await startServer(makeSessionStore(() => Promise.reject(new SessionRejectedError("identity mismatch"))));

        const rejectedRes = await post("/mcp", NON_INIT_BODY, { "mcp-session-id": "sess-rejected" });
        const rejectedBody = (await rejectedRes.json()) as unknown;

        await server.stop();
        await startServer(makeSessionStore(() => Promise.resolve(null)));

        const notFoundRes = await post("/mcp", NON_INIT_BODY, { "mcp-session-id": "sess-missing" });
        const notFoundBody = (await notFoundRes.json()) as unknown;

        // The rejected response must be indistinguishable from session-not-found
        // so that callers can't probe whether a session id is valid.
        expect(rejectedRes.status).toBe(notFoundRes.status);
        expect(rejectedBody).toEqual(notFoundBody);
    });

    it("logs the SessionRejectedError reason server-side", async () => {
        await startServer(makeSessionStore(() => Promise.reject(new SessionRejectedError("identity mismatch"))));

        await post("/mcp", NON_INIT_BODY, { "mcp-session-id": "sess-rejected" });

        const log = logger.messages.find((m) => m.level === "error" && m.payload.message.includes("identity mismatch"));
        expect(log).toBeDefined();
    });

    it("includes x-request-id in error log when handler throws", async () => {
        await startServer(makeSessionStore(() => Promise.reject(new Error("storage failure"))));

        const res = await post("/mcp", NON_INIT_BODY, {
            "mcp-session-id": "sess-err",
            "x-request-id": "req-throw",
        });

        expect(res.status).toBe(400);
        const log = logger.messages.find(
            (m) => m.level === "error" && m.payload.message.includes("Error handling request")
        );
        expect(log?.payload.attributes).toEqual(expect.objectContaining({ "x-request-id": "req-throw" }));
    });
});
