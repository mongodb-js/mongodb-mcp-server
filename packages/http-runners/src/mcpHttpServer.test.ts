import { describe, it, expect, afterEach, vi } from "vitest";
import type express from "express";
import { MCPHttpServer } from "./mcpHttpServer.js";
import type { LegacyMcpHandler, LegacySessionOptions } from "./legacyMcpHttpHandler.js";
import { RedactingLoggerBase, Keychain } from "@mongodb-js/mcp-core";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type {
    DefaultMetricDefinitions,
    IMetrics,
    ICompositeLogger,
    BaseServer,
    TransportRequestContext,
    HttpServerOptions,
    LogLevel,
    LogPayload,
    LoggerType,
    ILogger,
} from "@mongodb-js/mcp-types";
import type { DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

class MockMetrics
    extends PrometheusMetrics<DefaultPrometheusMetricDefinitions>
    implements IMetrics<DefaultMetricDefinitions>
{
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}

class InMemoryLogger extends RedactingLoggerBase implements ICompositeLogger {
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

const httpOptions: HttpServerOptions = {
    host: "127.0.0.1",
    port: 0,
    responseType: "json",
};

/** A 2026-07-28 request carrying the per-request `_meta` envelope claim. */
const MODERN_BODY = JSON.stringify({
    jsonrpc: "2.0",
    method: "tools/list",
    id: 1,
    params: {
        _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0" },
            requestId: "req-1",
        },
    },
});

function makeFakeServer(): BaseServer & { connect: (t: unknown) => Promise<void>; close: () => Promise<void> } {
    const mcpServer = new McpServer({ name: "test-server", version: "1.0.0" });
    mcpServer.registerTool(
        "echo",
        { inputSchema: z.object({ x: z.string() }) },

        ({ x }: { x: string }) => ({ content: [{ type: "text", text: x }] })
    );
    return {
        mcpServer,
        register: vi.fn().mockResolvedValue(undefined),
        connect: vi.fn().mockImplementation((transport: never) => mcpServer.connect(transport)),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

class TestMCPHttpServer extends MCPHttpServer<BaseServer> {
    constructor({ logger, sessionOptions }: { logger: InMemoryLogger; sessionOptions?: LegacySessionOptions }) {
        super({
            options: { http: httpOptions },
            logger,
            metrics: new MockMetrics(),
            sessionOptions,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected override createServerForRequest(_request: TransportRequestContext): Promise<BaseServer> {
        return Promise.resolve(makeFakeServer());
    }
}

describe("MCPHttpServer stateless serving", () => {
    let server: TestMCPHttpServer;
    let logger: InMemoryLogger;

    afterEach(async () => {
        await server?.stop();
    });

    async function startServer(): Promise<void> {
        logger = new InMemoryLogger();
        server = new TestMCPHttpServer({ logger });
        await server.start();
    }

    async function post(path: string, body: string, headers: Record<string, string> = {}): Promise<Response> {
        return fetch(`${server.serverAddress}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json", "mcp-method": "tools/list", ...headers },
            body,
        });
    }

    it("serves 2026-07-28 requests through the modern handler", async () => {
        await startServer();
        const res = await post("/mcp", MODERN_BODY);
        expect(res.status).toBe(200);
        const payload = (await res.json()) as { result?: { tools?: unknown[] } };
        expect(payload).toHaveProperty("result");
    });

    it("registers the request-scoped server for every request", async () => {
        const register = vi.fn().mockResolvedValue(undefined);
        class RegisterTrackingServer extends TestMCPHttpServer {
            protected override createServerForRequest(): Promise<BaseServer> {
                return Promise.resolve({ ...makeFakeServer(), register });
            }
        }
        logger = new InMemoryLogger();
        server = new RegisterTrackingServer({ logger });
        await server.start();

        await post("/mcp", MODERN_BODY);

        expect(register).toHaveBeenCalledTimes(1);
    });

    it("runs host middleware from registerMiddlewares() ahead of the /mcp handlers", async () => {
        class MiddlewareServer extends TestMCPHttpServer {
            protected override registerMiddlewares(): void {
                this.app.use((_req, res, next) => {
                    res.setHeader("x-mcp-middleware", "ran");
                    next();
                });
            }
        }
        logger = new InMemoryLogger();
        server = new MiddlewareServer({ logger });
        await server.start();

        const res = await post("/mcp", MODERN_BODY);

        expect(res.headers.get("x-mcp-middleware")).toBe("ran");
    });

    it("returns a 500 when the server factory throws", async () => {
        class ThrowingServer extends TestMCPHttpServer {
            protected override createServerForRequest(): Promise<BaseServer> {
                return Promise.reject(new Error("factory boom"));
            }
        }
        logger = new InMemoryLogger();
        server = new ThrowingServer({ logger });
        await server.start();

        const res = await post("/mcp", MODERN_BODY, { "x-request-id": "req-throw" });

        // The SDK entry reports factory failures as internal server errors.
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error?: { message?: string } };
        expect(body.error?.message).toBe("Internal server error");
    });

    it("carries no authInfo when no identity is injected", async () => {
        const seen = vi.fn();
        class StateTrackingServer extends TestMCPHttpServer {
            protected override createServerForRequest(request: TransportRequestContext): Promise<BaseServer> {
                seen(request.authInfo);
                return Promise.resolve(makeFakeServer());
            }
        }
        logger = new InMemoryLogger();
        server = new StateTrackingServer({ logger });
        await server.start();

        const res = await post("/mcp", MODERN_BODY);
        expect(res.status).toBe(200);
        // No identity injected → authInfo is absent (the host did not verify one).
        expect(seen).toHaveBeenCalledWith(undefined);
    });

    it("normalizes an injected req.auth identity into the authenticated auth state", async () => {
        const seen = vi.fn();
        class AuthedServer extends MCPHttpServer<BaseServer> {
            constructor() {
                super({
                    options: { http: httpOptions },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
            }
            protected override createServerForRequest(request: TransportRequestContext): Promise<BaseServer> {
                seen(request.authInfo);
                return Promise.resolve(makeFakeServer());
            }
        }
        server = new AuthedServer() as unknown as TestMCPHttpServer;
        // Host middleware injects the verified identity as `req.auth`, which
        // `toNodeHandler` forwards as the handler's authInfo.
        const app = (server as unknown as { app: express.Express }).app;
        app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
            (req as express.Request & { auth?: unknown }).auth = {
                token: "tok",
                clientId: "verified-client-1",
                scopes: [],
            };
            next();
        });
        await server.start();

        const res = await post("/mcp", MODERN_BODY, { authorization: "Bearer good-token" });
        expect(res.status).toBe(200);
        expect(seen).toHaveBeenCalledWith({ token: "tok", clientId: "verified-client-1", scopes: [] });
    });

    it("carries the host-supplied extra claims (per-user principal) through to the request auth state", async () => {
        const seen = vi.fn();
        class ExtraCarryingServer extends MCPHttpServer<BaseServer> {
            constructor() {
                super({
                    options: { http: httpOptions },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
            }
            protected override createServerForRequest(request: TransportRequestContext): Promise<BaseServer> {
                seen(request.authInfo);
                return Promise.resolve(makeFakeServer());
            }
        }
        server = new ExtraCarryingServer() as unknown as TestMCPHttpServer;
        // The host's token verifier attaches the user subject via the SDK's
        // AuthInfo.extra; per-user connection scoping depends on it surviving.
        const app = (server as unknown as { app: express.Express }).app;
        app.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
            (req as express.Request & { auth?: unknown }).auth = {
                token: "tok",
                clientId: "shared-org-gateway",
                scopes: [],
                extra: { sub: "alice" },
            };
            next();
        });
        await server.start();

        const res = await post("/mcp", MODERN_BODY, { authorization: "Bearer good-token" });
        expect(res.status).toBe(200);
        expect(seen).toHaveBeenCalledWith({
            token: "tok",
            clientId: "shared-org-gateway",
            scopes: [],
            extra: { sub: "alice" },
        });
    });

    describe("host-enforced authentication", () => {
        // The library never authenticates on its own: a host that requires
        // verified identity rejects identity-less requests in its own
        // middleware, which runs before protocol dispatch — covering the
        // modern AND legacy paths uniformly.
        class AuthRequiringServer extends MCPHttpServer<BaseServer> {
            constructor({ onRequest }: { onRequest?: (request: TransportRequestContext) => void } = {}) {
                super({
                    options: { http: httpOptions },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
                this.onRequest = onRequest;
            }
            private readonly onRequest?: (request: TransportRequestContext) => void;
            protected override createServerForRequest(request: TransportRequestContext): Promise<BaseServer> {
                this.onRequest?.(request);
                return Promise.resolve(makeFakeServer());
            }
            public requireAuth(): void {
                const app = (this as unknown as { app: express.Express }).app;
                app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
                    if (req.headers.authorization !== "Bearer good-token") {
                        res.status(401).json({ error: "Unauthorized" });
                        return;
                    }
                    (req as express.Request & { auth?: unknown }).auth = {
                        token: "tok",
                        clientId: "verified-client-1",
                        scopes: [],
                    };
                    next();
                });
            }
        }

        it("rejects requests without verified identity with 401, on both protocol paths", async () => {
            server = new AuthRequiringServer() as unknown as TestMCPHttpServer;
            (server as unknown as AuthRequiringServer).requireAuth();
            await server.start();

            // Modern (2026-07-28) request.
            expect((await post("/mcp", MODERN_BODY)).status).toBe(401);

            // Legacy (2025-era) request — same middleware rejects it before
            // protocol dispatch.
            const legacyRes = await fetch(`${server.serverAddress}/mcp`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    method: "initialize",
                    id: 1,
                    params: {
                        protocolVersion: "2025-11-25",
                        capabilities: {},
                        clientInfo: { name: "t", version: "1" },
                    },
                }),
            });
            expect(legacyRes.status).toBe(401);
        });

        it("serves verified requests with an always-authenticated authInfo", async () => {
            const seen = vi.fn();
            server = new AuthRequiringServer({ onRequest: seen }) as unknown as TestMCPHttpServer;
            (server as unknown as AuthRequiringServer).requireAuth();
            await server.start();

            const res = await post("/mcp", MODERN_BODY, { authorization: "Bearer good-token" });
            expect(res.status).toBe(200);
            expect(seen).toHaveBeenCalledWith(
                expect.objectContaining({
                    authInfo: { token: "tok", clientId: "verified-client-1", scopes: [] },
                })
            );
        });
    });

    describe("legacy (2025-era) sessionful serving", () => {
        // A 2025-era initialize: no `_meta` envelope claim, negotiated via the
        // legacy handshake. The server serves legacy traffic sessionfully so
        // the SDK's legacy elicitation shim has a live return channel.
        const LEGACY_INIT_BODY = JSON.stringify({
            jsonrpc: "2.0",
            method: "initialize",
            id: 1,
            params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "legacy-test", version: "1.0" },
            },
        });

        it("serves a legacy initialize POST sessionfully, issuing a session id", async () => {
            await startServer();
            const res = await fetch(`${server.serverAddress}/mcp`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "mcp-protocol-version": "2025-11-25",
                },
                body: LEGACY_INIT_BODY,
            });
            expect(res.status).toBe(200);
            expect(res.headers.get("mcp-session-id")).toBeTruthy();
            const text = await res.text();
            expect(text).toContain("protocolVersion");
            expect(text).toMatch(/"id":1/);
        });

        it("uses an overridden legacy handler / injected session store for legacy requests", async () => {
            const handle = vi
                .fn()
                .mockImplementation((req: express.Request, res: express.Response) =>
                    Promise.resolve(res.status(200).send())
                );
            const close = vi.fn().mockResolvedValue(undefined);
            class CustomLegacyServer extends TestMCPHttpServer {
                protected override createLegacyHandler(): LegacyMcpHandler {
                    return { handle, close };
                }
            }
            logger = new InMemoryLogger();
            server = new CustomLegacyServer({ logger });
            await server.start();

            // GET /mcp is legacy-only, so it is routed through the overridden handler.
            const res = await fetch(`${server.serverAddress}/mcp`, { method: "GET" });

            expect(res.status).toBe(200);
            expect(handle).toHaveBeenCalledTimes(1);
        });

        it("answers 2025 session operations (GET/DELETE) without a session id", async () => {
            await startServer();
            // In JSON response mode there is no SSE idle stream, so GET is 405.
            const getRes = await fetch(`${server.serverAddress}/mcp`, { method: "GET" });
            expect(getRes.status).toBe(405);

            const delRes = await fetch(`${server.serverAddress}/mcp`, { method: "DELETE" });
            expect(delRes.status).toBe(400);
            await expect(delRes.json()).resolves.toMatchObject({
                error: { code: -32001, message: "session id is required" },
            });
        });

        it("reports legacy session errors with main's codes and statuses", async () => {
            await startServer();
            const post = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
                fetch(`${server.serverAddress}/mcp`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        accept: "application/json, text/event-stream",
                        ...headers,
                    },
                    body,
                });

            // Non-initialize POST without a session id: invalid request.
            const noSession = await post(JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2, params: {} }));
            expect(noSession.status).toBe(400);
            await expect(noSession.json()).resolves.toMatchObject({
                error: { code: -32004, message: "invalid request" },
            });

            // Unknown session id: not found.
            const unknownSession = await post(
                JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 3, params: {} }),
                { "mcp-session-id": "does-not-exist" }
            );
            expect(unknownSession.status).toBe(404);
            await expect(unknownSession.json()).resolves.toMatchObject({
                error: { code: -32003, message: "session not found" },
            });

            // Initialize carrying a session id: disallowed (no externally managed sessions here).
            const initWithSession = await post(LEGACY_INIT_BODY, { "mcp-session-id": "external-id" });
            expect(initWithSession.status).toBe(400);
            await expect(initWithSession.json()).resolves.toMatchObject({
                error: { code: -32005 },
            });
        });

        it("accepts a client-supplied session id on initialize when externally managed sessions are enabled", async () => {
            const myLogger = new InMemoryLogger();
            class ExternalServer extends TestMCPHttpServer {
                constructor() {
                    super({
                        logger: myLogger,
                        sessionOptions: { externallyManagedSessions: true },
                    });
                }
            }
            server = new ExternalServer();
            await server.start();

            const res = await fetch(`${server.serverAddress}/mcp`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "mcp-protocol-version": "2025-11-25",
                    "mcp-session-id": "external-id",
                },
                body: LEGACY_INIT_BODY,
            });

            expect(res.status).toBe(200);
            // The client-supplied id is honored, not rejected.
            expect(res.headers.get("mcp-session-id")).toBe("external-id");
        });

        it("implicitly re-initializes a missing session for an externally managed session id", async () => {
            const myLogger = new InMemoryLogger();
            class ExternalServer extends TestMCPHttpServer {
                constructor() {
                    super({
                        logger: myLogger,
                        sessionOptions: { externallyManagedSessions: true },
                    });
                }
            }
            server = new ExternalServer();
            await server.start();

            // A session-carrying request (non-initialize) whose id is not in the
            // store. With externally managed sessions enabled the handler attempts
            // an implicit re-initialization instead of rejecting with 404.
            const res = await fetch(`${server.serverAddress}/mcp`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                    "mcp-protocol-version": "2025-11-25",
                    "mcp-session-id": "external-id",
                },
                body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 4, params: {} }),
            });

            expect(res.status).toBe(200);
        });
    });
});

describe("MCPHttpServer dangerous-host binding guard", () => {
    let server: MCPHttpServer<BaseServer> | undefined;

    afterEach(async () => {
        await server?.stop().catch(() => undefined);
        server = undefined;
    });

    function makeDangerousServer(host: string, dangerousHostBinding?: boolean): MCPHttpServer<BaseServer> {
        const opts: HttpServerOptions = {
            host,
            port: 0,
            responseType: "json",
            ...(dangerousHostBinding !== undefined ? { dangerousHostBinding } : {}),
        };
        return new (class DangerousServer extends MCPHttpServer<BaseServer> {
            constructor() {
                super({
                    options: { http: opts },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
            }

            protected override createServerForRequest(_request: TransportRequestContext): Promise<BaseServer> {
                return Promise.resolve(makeFakeServer());
            }
        })();
    }

    it("throws when binding to 0.0.0.0 without the opt-in", async () => {
        server = makeDangerousServer("0.0.0.0");
        await expect(server.start()).rejects.toThrow(/non-loopback host "0.0.0.0"/);
    });

    it("throws when binding to an all-interfaces (empty) host without the opt-in", async () => {
        server = makeDangerousServer("");
        await expect(server.start()).rejects.toThrow(/non-loopback host "<all interfaces>"/);
    });

    it("throws when binding to a LAN IP without the opt-in", async () => {
        server = makeDangerousServer("192.168.1.10");
        await expect(server.start()).rejects.toThrow(/non-loopback host "192.168.1.10"/);
    });

    it("starts on a dangerous host when dangerousHostBinding is set", async () => {
        server = makeDangerousServer("0.0.0.0", true);
        await expect(server.start()).resolves.toBeUndefined();
    });

    it("starts on loopback without the opt-in", async () => {
        server = makeDangerousServer("127.0.0.1");
        await expect(server.start()).resolves.toBeUndefined();
    });
});
