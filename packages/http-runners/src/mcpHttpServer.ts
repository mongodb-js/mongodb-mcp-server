import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler, McpRequestContext, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express from "express";
import type {
    ICompositeLogger,
    IMetrics,
    DefaultMetricDefinitions,
    TransportRequestContext,
    HttpServerOptions,
    RequestAuthInfo,
    ServerLike,
} from "@mongodb-js/mcp-types";
import {
    LogId,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    UserFacingError,
    requestIdAttr,
} from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";

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
};



/**
 * HTTP server that serves MCP requests over HTTP using the stateless
 * protocol of revision 2026-07-28 through the SDK's `createMcpHandler`
 * entry.
 *
 * The server is deliberately stateless: no per-client sessions, no
 * `mcp-session-id` routing, no server-held transports. Each request is
 * served by a fresh request-scoped server instance produced by
 * {@link createServerForRequest}; all heavy dependencies (connections,
 * exports, API client, telemetry) live once per process and are referenced,
 * not owned, by each request's instance. 2025-era sessionful traffic is not
 * served (`legacy: "reject"`).
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
    TServer extends ServerLike = ServerLike,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends ExpressBasedHttpServer {
    /** The 2026-07-28 serving entry; every request is routed here. */
    private readonly modernHandler: McpHttpHandler;
    protected readonly metrics: IMetrics<TMetrics>;

    constructor({ options, logger, metrics }: MCPHttpServerOptions<TMetrics>) {
        super({
            options: {
                logContext: "mcpHttpServer",
                http: options.http,
            },
            logger,
        });
        this.metrics = metrics;
        this.modernHandler = this.createModernHandler();
    }

    public async stop(): Promise<void> {
        await Promise.all([this.modernHandler.close(), super.stop()]);
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation.
     */
    protected abstract createServerForRequest(request: TransportRequestContext): Promise<TServer>;

    /**
     * Builds the 2026-07-28 serving entry. One factory backs every request:
     * it constructs a fresh request-scoped server, registers it, and hands
     * the underlying {@link McpServer} to `createMcpHandler`. `legacy:
     * 'stateless'` serves 2025-era traffic through the SDK's stateless
     * fallback — each request is answered by a fresh instance over a
     * stateless streamable HTTP transport (no `Mcp-Session-Id`, no
     * server-held per-client state).
     */
    protected createModernHandler(): McpHttpHandler {
        return createMcpHandler(
            async (ctx: McpRequestContext) => {
                const request: TransportRequestContext = {
                    headers: Object.fromEntries(ctx.requestInfo?.headers ?? []),
                    query: ctx.requestInfo?.url
                        ? Object.fromEntries(new URL(ctx.requestInfo.url).searchParams)
                        : undefined,
                    // Verified identity of the authenticated client (auth mode), threaded
                    // through so the request-scoped server can scope state by clientId.
                    authInfo: ctx.authInfo,
                };
                const server = await this.createServerForRequest(request);
                await server.register();
                return server.mcpServer as unknown as McpServer;
            },
            { legacy: "stateless" }
        );
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

        const authenticate = this.httpOptions.authenticate;
        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                let authInfo: RequestAuthInfo | undefined;
                if (authenticate) {
                    // Auth is mandatory when an authenticator is configured:
                    // resolve (and require) the verified identity for this
                    // request, rejecting 401 when it cannot be established. The
                    // verified identity is threaded into the handler so
                    // per-request servers can scope state by clientId.
                    authInfo = await authenticate(req.headers);
                    if (!authInfo) {
                        res.status(401).json({ error: "Unauthorized: could not verify request identity" });
                        return;
                    }
                }
                await toNodeHandler({
                    fetch: (request, opts) =>
                        this.modernHandler.fetch(request, { ...opts, authInfo }),
                })(req, res, req.body);
            })
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
