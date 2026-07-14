import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { MCPHttpServer } from "../../../src/transports/mcpHttpServer.js";
import { defaultTestConfig, InMemoryLogger } from "../../integration/helpers.js";
import { MockMetrics } from "../mocks/metrics.js";
import { Keychain } from "../../../src/common/keychain.js";
import {
    SessionRejectedError,
    SessionLimitExceededError,
    type ISessionStore,
} from "../../../src/common/sessionStore.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "../../../src/server.js";
import { JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED } from "../../../src/transports/jsonRpcErrorCodes.js";

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

function makeSessionStore(
    getSessionImpl: () => Promise<StreamableHTTPServerTransport | null>
): ISessionStore<StreamableHTTPServerTransport> {
    return {
        getSession: vi.fn().mockImplementation(getSessionImpl),
        addSession: vi.fn(),
        closeSession: vi.fn().mockResolvedValue(undefined),
        closeAllSessions: vi.fn().mockResolvedValue(undefined),
        saveNegotiatedClientState: vi.fn().mockResolvedValue(undefined),
        loadNegotiatedClientState: vi.fn().mockResolvedValue(undefined),
    };
}

function makeFakeServer(): Server {
    return {
        session: {
            logger: {
                setAttribute: vi.fn(),
                debug: vi.fn(),
                warning: vi.fn(),
                info: vi.fn(),
                error: vi.fn(),
            },
            setMcpClient: vi.fn(),
        },
        mcpServer: {
            server: {
                oninitialized: undefined,
                getClientCapabilities: vi.fn(),
                getClientVersion: vi.fn(),
            },
        },
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Server;
}

describe("MCPHttpServer x-request-id logging", () => {
    let server: MCPHttpServer;
    let logger: InMemoryLogger;

    afterEach(async () => {
        await server?.stop();
    });

    async function startServer(
        sessionStore: ISessionStore<StreamableHTTPServerTransport>,
        createServerForRequest: () => Promise<Server> = vi.fn()
    ): Promise<void> {
        logger = new InMemoryLogger(Keychain.root);
        server = new MCPHttpServer({
            userConfig: { ...defaultTestConfig, httpPort: 0 },
            createServerForRequest,
            logger,
            metrics: new MockMetrics(),
            sessionStore,
        });
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
        await startServer(sessionStore, () => Promise.resolve(makeFakeServer()));

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

    it("responds with 503 when sessionStore.addSession throws SessionLimitExceededError", async () => {
        const addSession = vi
            .fn()
            .mockRejectedValue(new SessionLimitExceededError("Session limit of 1 concurrent sessions reached"));
        const sessionStore: ISessionStore<StreamableHTTPServerTransport> = {
            ...makeSessionStore(() => Promise.resolve(null)),
            addSession,
        };
        await startServer(sessionStore, () => Promise.resolve(makeFakeServer()));

        const res = await post("/mcp", INIT_BODY, {});
        const body = (await res.json()) as { error: { code: number } };

        expect(res.status).toBe(503);
        expect(body.error.code).toBe(JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED);
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

describe("MCPHttpServer keepalive pings", () => {
    const KEEP_ALIVE_INTERVAL_MS = 30_000;
    const SESSION_ID = "11111111111111111111111111111111";

    let server: MCPHttpServer;
    let capturedTransports: Map<string, StreamableHTTPServerTransport>;
    let sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    let openStreams: AbortController[];

    beforeEach(() => {
        // Fake only interval scheduling so real HTTP requests keep working while
        // the keepalive ticks are driven deterministically from the tests.
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
        openStreams = [];
        capturedTransports = new Map();
        sessionStore = {
            getSession: vi
                .fn()
                .mockImplementation((sessionId: string) => Promise.resolve(capturedTransports.get(sessionId) ?? null)),
            addSession: vi
                .fn()
                .mockImplementation(
                    ({
                        sessionId,
                        transport,
                    }: {
                        sessionId: string;
                        transport: StreamableHTTPServerTransport;
                    }): Promise<void> => {
                        capturedTransports.set(sessionId, transport);
                        return Promise.resolve();
                    }
                ),
            closeSession: vi.fn().mockResolvedValue(undefined),
            closeAllSessions: vi.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(async () => {
        for (const controller of openStreams) {
            controller.abort();
        }
        await server?.stop();
        vi.useRealTimers();
    });

    async function startServer(): Promise<void> {
        server = new MCPHttpServer({
            userConfig: {
                ...defaultTestConfig,
                httpPort: 0,
                httpResponseType: "sse",
                externallyManagedSessions: true,
            },
            createServerForRequest: (): Promise<Server> => Promise.resolve(makeFakeServer()),
            logger: new InMemoryLogger(Keychain.root),
            metrics: new MockMetrics(),
            sessionStore,
        });
        await server.start();
    }

    /** Opens the standalone SSE stream (GET) for the given session, implicitly initializing it. */
    async function openStandaloneStream(sessionId: string): Promise<Response> {
        const controller = new AbortController();
        openStreams.push(controller);
        return fetch(`${server.serverAddress}/mcp`, {
            method: "GET",
            headers: { accept: "text/event-stream", "mcp-session-id": sessionId },
            signal: controller.signal,
        });
    }

    function countPings(calls: unknown[][]): number {
        return calls.filter((call) => (call[0] as { method?: string } | undefined)?.method === "ping").length;
    }

    /** Lets in-flight socket events (e.g. a client abort) reach the server before continuing. */
    async function settleRealIo(): Promise<void> {
        // setTimeout is intentionally not faked, so this waits real time.
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    it("does not ping sessions that never open a standalone SSE stream", async () => {
        await startServer();

        // Create a session via initialize without ever opening the GET stream — the
        // situation of every client when the standalone stream is not offered (e.g.
        // deployments that reject GET upstream). Pings have nowhere to go and must not
        // be attempted, and the transport must not be closed as a consequence.
        const initRes = await fetch(`${server.serverAddress}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
            body: INIT_BODY,
        });
        expect(initRes.status).toBe(200);
        await initRes.body?.cancel();

        const transport = [...capturedTransports.values()][0];
        expect(transport).toBeDefined();
        const sendSpy = vi.spyOn(transport as StreamableHTTPServerTransport, "send");
        const closeSpy = vi.spyOn(transport as StreamableHTTPServerTransport, "close");

        await vi.advanceTimersByTimeAsync(5 * KEEP_ALIVE_INTERVAL_MS);

        expect(countPings(sendSpy.mock.calls)).toBe(0);
        expect(closeSpy).not.toHaveBeenCalled();
    });

    it("pings while a standalone SSE stream is open and stops when it closes", async () => {
        await startServer();

        const streamRes = await openStandaloneStream(SESSION_ID);
        expect(streamRes.status).toBe(200);
        const transport = capturedTransports.get(SESSION_ID);
        expect(transport).toBeDefined();
        const sendSpy = vi.spyOn(transport as StreamableHTTPServerTransport, "send");

        await vi.advanceTimersByTimeAsync(2 * KEEP_ALIVE_INTERVAL_MS);
        expect(countPings(sendSpy.mock.calls)).toBe(2);

        // Client drops the stream; the loop must stop instead of pinging into the void.
        openStreams.shift()?.abort();
        await settleRealIo();

        sendSpy.mockClear();
        await vi.advanceTimersByTimeAsync(2 * KEEP_ALIVE_INTERVAL_MS);
        expect(countPings(sendSpy.mock.calls)).toBe(0);
    });

    it("keeps pinging the active stream when a concurrent GET is rejected", async () => {
        await startServer();

        const first = await openStandaloneStream(SESSION_ID);
        expect(first.status).toBe(200);
        const transport = capturedTransports.get(SESSION_ID);
        const sendSpy = vi.spyOn(transport as StreamableHTTPServerTransport, "send");

        // Only one standalone stream is allowed per session; the second GET is rejected
        // and its teardown must not stop the loop belonging to the active stream.
        const second = await openStandaloneStream(SESSION_ID);
        expect(second.status).toBe(409);
        await settleRealIo();

        await vi.advanceTimersByTimeAsync(KEEP_ALIVE_INTERVAL_MS);
        expect(countPings(sendSpy.mock.calls)).toBe(1);
    });

    it("closes the transport after more than 3 consecutive failed pings", async () => {
        await startServer();

        const streamRes = await openStandaloneStream(SESSION_ID);
        expect(streamRes.status).toBe(200);
        const transport = capturedTransports.get(SESSION_ID);
        const sendSpy = vi
            .spyOn(transport as StreamableHTTPServerTransport, "send")
            .mockRejectedValue(new Error("stream broken"));
        const closeSpy = vi.spyOn(transport as StreamableHTTPServerTransport, "close");

        await vi.advanceTimersByTimeAsync(4 * KEEP_ALIVE_INTERVAL_MS);

        expect(sendSpy).toHaveBeenCalledTimes(4);
        expect(closeSpy).toHaveBeenCalledTimes(1);
    });
});
