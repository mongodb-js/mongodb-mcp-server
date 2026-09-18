import {
    createMcpHandler,
    isLegacyRequest,
    type McpHttpHandler,
    type McpRequestContext,
} from "@modelcontextprotocol/server";
import { toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import type { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import express from "express";
import type {
    ICompositeLogger,
    IMetrics,
    DefaultMetricDefinitions,
    TransportRequestContext,
    HttpServerOptions,
    BaseServer,
} from "@mongodb-js/mcp-types";
import {
    LogId,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    UserFacingError,
    requestIdAttr,
    SessionStore,
} from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import { LegacyMcpHttpHandler, type LegacyMcpHandler, type LegacySessionOptions } from "./legacyMcpHttpHandler.js";

/**
 * Options for creating an MCPHttpServer instance.
 */
export type MCPHttpServerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
    options: {
        /** HTTP server options */
        http: HttpServerOptions;
    };
    /** Logger for the server */
    logger: ICompositeLogger;
    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
    /**
     * Tunables for the 2025-era (legacy) session lifecycle: the `maxSessions`
     * cap, the idle/notification timeouts, and the LRU eviction idle grace. See
     * {@link LegacySessionOptions}.
     */
    sessionOptions?: LegacySessionOptions;
};

/**
 * Request methods the 2026-07-28 registry introduced with no 2025-era
 * counterpart. A request naming one of them is modern-intent even when it
 * arrives without the per-request `_meta` envelope claim, because no 2025-era
 * client has a code path that emits it.
 */
const MODERN_ONLY_METHODS = new Set<string>(["server/discover", "subscriptions/listen"]);

/**
 * Whether a parsed POST body is a single JSON-RPC message naming a
 * {@link MODERN_ONLY_METHODS} method. Those are routed to the modern handler
 * regardless of the envelope claim, so the SDK's validation ladder answers a
 * claim-less one with the unsupported-protocol-version error naming the
 * versions this endpoint serves — the answer a modern client can act on. A
 * claim-less request to a method both eras share stays 2025-era traffic.
 */
function isModernOnlyMethodRequest(body: unknown): boolean {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return false;
    }
    const { method } = body as { method?: unknown };
    return typeof method === "string" && MODERN_ONLY_METHODS.has(method);
}

/**
 * HTTP server that serves MCP requests over HTTP.
 *
 * The 2026-07-28 protocol is served **statelessly** through the SDK's
 * `createMcpHandler` (`legacy: 'reject'`): each request builds a fresh
 * request-scoped server and carries client identity per request in the `_meta`
 * envelope. No per-client sessions, no `mcp-session-id` routing on that path.
 *
 * 2025-era (legacy) requests are delegated to a sessionful
 * {@link LegacyMcpHttpHandler} (see its docs for why): the 2025 protocol needs
 * a live, correlated transport for its `initialize`-declared capabilities and
 * server→client elicitation, which the SDK's `legacy: 'stateless'` mode cannot
 * provide. The modern/legacy split is isolated from this class so each path
 * stays clean.
 *
 * @example
 * ```typescript
 * class MyMCPHttpServer extends MCPHttpServer {
 *   protected override async createServerForRequest(request: TransportRequestContext): Promise<MyServer> {
 *     return new MyServer({ ... });
 *   }
 * }
 * ```
 */
export abstract class MCPHttpServer<
    TServer extends BaseServer = BaseServer,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends ExpressBasedHttpServer {
    /** The 2026-07-28 serving entry; modern requests are routed here. */
    private readonly modernHandler: McpHttpHandler;
    /** Sessionful 2025-era serving (initialize/SSE/requests carried per session). */
    private readonly legacyHandler: LegacyMcpHandler;
    protected readonly metrics: IMetrics<TMetrics>;

    constructor({ options, logger, metrics, sessionOptions }: MCPHttpServerOptions<TMetrics>) {
        super({
            options: {
                logContext: "mcpHttpServer",
                http: options.http,
            },
            logger,
        });
        this.metrics = metrics;
        this.modernHandler = this.createModernHandler();
        this.legacyHandler = this.createLegacyHandler({ logger, http: options.http, sessionOptions });
    }

    public async stop(): Promise<void> {
        await Promise.allSettled([this.modernHandler.close(), this.legacyHandler.close()]);
        await super.stop();
    }

    /**
     * Builds the handler that serves 2025-era (legacy) traffic. Subclasses may
     * override this to plug in an alternative legacy transport/session
     * implementation; the default returns a {@link LegacyMcpHttpHandler} built
     * from {@link MCPHttpServer.createServerForRequest}.
     */
    protected createLegacyHandler({
        logger,
        http,
        sessionOptions,
    }: {
        logger: ICompositeLogger;
        http: HttpServerOptions;
        sessionOptions?: LegacySessionOptions;
    }): LegacyMcpHandler {
        return new LegacyMcpHttpHandler({
            createServer: async (request): Promise<TServer> => this.createServerForRequest(request),
            logger,
            http,
            externallyManagedSessions: sessionOptions?.externallyManagedSessions ?? false,
            sessionStore: new SessionStore<NodeStreamableHTTPServerTransport>({
                options: {
                    idleTimeoutMS: sessionOptions?.idleTimeoutMS ?? 600_000,
                    notificationTimeoutMS: sessionOptions?.notificationTimeoutMS ?? 540_000,
                    maxSessions: sessionOptions?.maxSessions ?? 1000,
                    evictionIdleGraceMS: sessionOptions?.evictionIdleGraceMS ?? 120_000,
                },
                logger,
                metrics: this.metrics,
            }),
        });
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation.
     */
    protected abstract createServerForRequest(request: TransportRequestContext): Promise<TServer>;

    /** Request middleware hook for `/mcp`, called after body parse + header validation, before routing. */
    protected registerMiddlewares(): void {}

    /**
     * Builds the 2026-07-28 serving entry. One factory backs every modern
     * request: it constructs a fresh request-scoped server, registers it, and
     * hands the underlying {@link McpServer} to `createMcpHandler`.
     * `legacy: 'reject'` means this entry serves ONLY the 2026-07-28 era;
     * 2025-era traffic is routed to the sessionful legacy handler (see
     * {@link LegacyMcpHttpHandler}).
     */
    protected createModernHandler(): McpHttpHandler {
        const handler = createMcpHandler(
            async (ctx: McpRequestContext) => {
                const request: TransportRequestContext = {
                    headers: Object.fromEntries(ctx.requestInfo?.headers ?? []),
                    query: ctx.requestInfo?.url
                        ? Object.fromEntries(new URL(ctx.requestInfo.url).searchParams)
                        : undefined,
                    // The verified identity of this request, carried through from
                    // the SDK's pass-through authInfo (hosts supply it via `req.auth`
                    // through the node adapter, or directly). Absent when the host
                    // injected none. The server never authenticates on its own: hosts
                    // that require verified identity enforce it in their own
                    // middleware (see registerMiddlewares), uniformly for the modern
                    // and legacy paths.
                    authInfo: ctx.authInfo,
                    protocol: "2026-07-28",
                };
                const server = await this.createServerForRequest(request);
                await server.register();
                return server.mcpServer;
            },
            { legacy: "reject" }
        );

        return handler;
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- Required for override signature
    protected override async setupRoutes(): Promise<void> {
        this.app.use(express.json({ limit: this.httpOptions.bodyLimit ?? 1024 * 1024 }));

        const headers = this.httpOptions.headers;
        if (headers && Object.keys(headers).length > 0) {
            // eslint-disable-next-line max-params -- express middleware callback signature
            this.app.use((req, res, next) => {
                for (const [key, value] of Object.entries(headers)) {
                    const header = req.headers[key.toLowerCase()];
                    if (!header || header !== value) {
                        res.status(403).json({ error: `Invalid value for header "${key}"` });
                        return;
                    }
                }
                next();
            });
        }

        this.registerMiddlewares();

        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                // 2025-era (no envelope claim) requests are served sessionfully so
                // the legacy elicitation shim has a live return channel. Everything
                // else (modern-enveloped, or naming a method only the 2026-07-28
                // era has) goes to the stateless modern handler.
                const webRequest = await toWebRequest(req, req.body);
                if (!isModernOnlyMethodRequest(req.body) && (await isLegacyRequest(webRequest))) {
                    return await this.legacyHandler.handle(req, res);
                }
                return await toNodeHandler({ fetch: (request, opts) => this.modernHandler.fetch(request, opts) })(
                    req,
                    res,
                    req.body
                );
            })
        );

        // 2025-era session operations (SSE idle stream via GET, session close via
        // DELETE) only exist on the sessionful legacy path.
        this.app.get(
            "/mcp",
            this.withErrorHandling((req, res) => this.legacyHandler.handle(req, res))
        );
        this.app.delete(
            "/mcp",
            this.withErrorHandling((req, res) => this.legacyHandler.handle(req, res))
        );
    }

    private withErrorHandling(
        // eslint-disable-next-line max-params -- express-style request handler function type
        fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
    ) {
        // eslint-disable-next-line max-params -- express middleware callback signature
        return (req: express.Request, res: express.Response, next: express.NextFunction): void => {
            fn(req, res, next).catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error({
                    id: LogId.streamableHttpTransportRequestFailure,
                    context: "streamableHttpTransport",
                    message: `Error handling request: ${errorMessage}`,
                    attributes: { ...requestIdAttr(req.headers) },
                });

                // Only propagate error messages for user-facing errors
                const message = error instanceof UserFacingError ? error.message : `failed to handle request`;

                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                        message,
                    },
                });
            });
        };
    }
}
