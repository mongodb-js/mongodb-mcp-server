import { describe, it, expect, afterEach, vi } from "vitest";
import { MCPHttpServer } from "../../../src/transports/mcpHttpServer.js";
import { defaultTestConfig, InMemoryLogger } from "../../integration/helpers.js";
import { MockMetrics } from "../mocks/metrics.js";
import { Keychain } from "../../../src/common/keychain.js";
import type { ISessionStore } from "../../../src/common/sessionStore.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "../../../src/server.js";

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
