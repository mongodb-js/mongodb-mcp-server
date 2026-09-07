import {
    createMcpHandler,
    isLegacyRequest,
    type McpHttpHandler,
    type McpRequestContext,
} from "@modelcontextprotocol/server";
import { toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
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
} from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import { LegacyMcpHttpHandler, type LegacyMcpHandler } from "./legacyMcpHttpHandler.js";
import type { LegacySessionOptions } from "@mongodb-js/mcp-core";

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
            sessionOptions,
        });
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation.
     */
    protected abstract createServerForRequest(request: TransportRequestContext): Promise<TServer>;

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
                    // The explicit auth state of this request, normalized from the
                    // SDK's pass-through authInfo (hosts supply it via `req.auth`
                    // through the node adapter, or directly). "Unauthenticated" when
                    // no identity was injected.
                    authInfo: ctx.authInfo
                        ? { mode: "authenticated", state: ctx.authInfo }
                        : { mode: "unauthenticated" },
                };
                const server = await this.createServerForRequest(request);
                await server.register();
                return server.mcpServer;
            },
            { legacy: "reject" }
        );

        if (this.httpOptions.authMode !== "authenticated") {
            return handler;
        }

        // Authenticated mode, enforced at handler creation: every request must
        // carry verified identity (host-supplied authInfo). Requests without it
        // are rejected with 401 before the SDK sees them.
        return {
            ...handler,
            fetch: async (request, options): Promise<Response> => {
                if (!options?.authInfo) {
                    return new Response(JSON.stringify({ error: "Unauthorized: authenticated request required" }), {
                        status: 401,
                        headers: {
                            "content-type": "application/json",
                            "www-authenticate": "Bearer",
                        },
                    });
                }
                return handler.fetch(request, options);
            },
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- Required for override signature
    protected override async setupRoutes(): Promise<void> {
        this.app.use(express.json({ limit: this.httpOptions.bodyLimit ?? 1024 * 1024 }));

        const headers = this.httpOptions.headers;
        if (headers && Object.keys(headers).length > 0) {
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

        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                // 2025-era (no envelope claim) requests are served sessionfully so
                // the legacy elicitation shim has a live return channel. Everything
                // else (modern-enveloped) goes to the stateless modern handler.
                const webRequest = await toWebRequest(req, req.body);
                if (await isLegacyRequest(webRequest)) {
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
        fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<void>
    ) {
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
