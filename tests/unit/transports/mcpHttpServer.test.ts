import { describe, it, expect, afterEach, vi } from "vitest";
import { MCPHttpServer } from "../../../src/transports/mcpHttpServer.js";
import { defaultTestConfig, InMemoryLogger } from "../../integration/helpers.js";
import { MockMetrics } from "../mocks/metrics.js";
import { Keychain } from "../../../src/common/keychain.js";
import type { ISessionStore } from "../../../src/common/sessionStore.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

describe("MCPHttpServer x-request-id logging", () => {
    let server: MCPHttpServer;
    let logger: InMemoryLogger;

    afterEach(async () => {
        await server?.stop();
    });

    async function startServer(sessionStore: ISessionStore<StreamableHTTPServerTransport>): Promise<void> {
        logger = new InMemoryLogger(Keychain.root);
        server = new MCPHttpServer({
            userConfig: { ...defaultTestConfig, httpPort: 0 },
            createServerForRequest: vi.fn(),
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
