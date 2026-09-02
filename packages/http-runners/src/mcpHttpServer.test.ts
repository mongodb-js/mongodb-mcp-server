import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import { MCPHttpServer } from "./mcpHttpServer.js";
import { LoggerBase, Keychain } from "@mongodb-js/mcp-core";
import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type {
    DefaultMetricDefinitions,
    IMetrics,
    ICompositeLogger,
    ServerLike,
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

function makeFakeServer(): ServerLike {
    const mcpServer = new McpServer({ name: "test-server", version: "1.0.0" });
    mcpServer.registerTool(
        "echo",
        { inputSchema: z.object({ x: z.string() }) },

        ({ x }: { x: string }) => ({ content: [{ type: "text", text: x }] })
    );
    return {
        mcpServer,
        register: vi.fn().mockResolvedValue(undefined),
    };
}

class TestMCPHttpServer extends MCPHttpServer<ServerLike> {
    constructor({ logger }: { logger: InMemoryLogger }) {
        super({
            options: { http: httpOptions },
            logger,
            metrics: new MockMetrics(),
        });
    }

    protected override createServerForRequest(): Promise<ServerLike> {
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
            protected override createServerForRequest(): Promise<ServerLike> {
                return Promise.resolve({ ...makeFakeServer(), register });
            }
        }
        logger = new InMemoryLogger();
        server = new RegisterTrackingServer({ logger });
        await server.start();

        await post("/mcp", MODERN_BODY);

        expect(register).toHaveBeenCalledTimes(1);
    });

    it("returns a 500 when the server factory throws", async () => {
        class ThrowingServer extends TestMCPHttpServer {
            protected override createServerForRequest(): Promise<ServerLike> {
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

    it("carries an explicit unauthenticated auth state when no identity is injected", async () => {
        const seen = vi.fn();
        class StateTrackingServer extends TestMCPHttpServer {
            protected override createServerForRequest(request: TransportRequestContext): Promise<ServerLike> {
                seen(request.authInfo);
                return Promise.resolve(makeFakeServer());
            }
        }
        logger = new InMemoryLogger();
        server = new StateTrackingServer({ logger });
        await server.start();

        const res = await post("/mcp", MODERN_BODY);
        expect(res.status).toBe(200);
        // No identity injected → the request is explicitly unauthenticated.
        expect(seen).toHaveBeenCalledWith({ mode: "unauthenticated" });
    });

    it("normalizes an injected req.auth identity into the authenticated auth state", async () => {
        const seen = vi.fn();
        class AuthedServer extends MCPHttpServer<ServerLike> {
            constructor() {
                super({
                    options: { http: httpOptions },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
            }
            protected override createServerForRequest(request: TransportRequestContext): Promise<ServerLike> {
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
        expect(seen).toHaveBeenCalledWith({
            mode: "authenticated",
            state: { token: "tok", clientId: "verified-client-1", scopes: [] },
        });
    });

    describe("authenticated mode (authMode: 'authenticated')", () => {
        class AuthedModeServer extends MCPHttpServer<ServerLike> {
            constructor({ onRequest }: { onRequest?: (request: TransportRequestContext) => void } = {}) {
                super({
                    options: { http: { ...httpOptions, authMode: "authenticated" } },
                    logger: new InMemoryLogger(),
                    metrics: new MockMetrics(),
                });
                this.onRequest = onRequest;
            }
            private readonly onRequest?: (request: TransportRequestContext) => void;
            protected override createServerForRequest(request: TransportRequestContext): Promise<ServerLike> {
                this.onRequest?.(request);
                return Promise.resolve(makeFakeServer());
            }
        }

        it("rejects requests without verified identity with 401", async () => {
            server = new AuthedModeServer() as unknown as TestMCPHttpServer;
            await server.start();

            const res = await post("/mcp", MODERN_BODY);
            expect(res.status).toBe(401);
        });

        it("serves verified requests with an always-authenticated authInfo", async () => {
            const seen = vi.fn();
            server = new AuthedModeServer({ onRequest: seen }) as unknown as TestMCPHttpServer;
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
            expect(seen).toHaveBeenCalledWith(
                expect.objectContaining({
                    authInfo: {
                        mode: "authenticated",
                        state: { token: "tok", clientId: "verified-client-1", scopes: [] },
                    },
                })
            );
        });
    });
});
