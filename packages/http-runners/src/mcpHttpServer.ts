import { isInitializeRequest, createMcpHandler, isLegacyRequest } from "@modelcontextprotocol/server";
import type {
    ClientCapabilities,
    Implementation,
    McpHttpHandler,
    McpRequestContext,
    McpServer,
} from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport, toNodeHandler, toWebRequest } from "@modelcontextprotocol/node";
import express from "express";
import type {
    ICompositeLogger,
    ILogger,
    IMetrics,
    DefaultMetricDefinitions,
    TransportRequestContext,
    ISessionStore,
    HttpServerOptions,
    SessionManagementOptions,
    SessionServer,
    NegotiatedClientState,
} from "@mongodb-js/mcp-types";
import {
    LogId,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED,
    UserFacingError,
    getRandomUUID,
    SessionRejectedError,
    SessionLimitExceededError,
    requestIdAttr,
} from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import { sleep } from "./utils.js";

/**
 * Options for creating an MCPHttpServer instance.
 */
export type MCPHttpServerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
    options: {
        /** HTTP server options */
        http: HttpServerOptions;
        /** Session management options */
        session: SessionManagementOptions;
    };
    /** Logger for the server */
    logger: ICompositeLogger;
    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
    /** Session store for managing transports */
    sessionStore: ISessionStore<NodeStreamableHTTPServerTransport>;
};

/**
 * HTTP server that handles MCP requests over HTTP using the Streamable HTTP transport.
 *
 * Serves protocol revision 2026-07-28 through the SDK's `createMcpHandler`
 * entry (via {@link createModernHandler}) and keeps serving 2025-era clients
 * through the established sessionful `NodeStreamableHTTPServerTransport`
 * wiring, routing each POST with the `isLegacyRequest` predicate — the
 * pattern the migration guide prescribes for sessionful legacy setups.
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
    TServer extends SessionServer = SessionServer,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<NodeStreamableHTTPServerTransport>;
    /** The 2026-07-28 serving entry; modern requests are routed here. */
    private readonly modernHandler: McpHttpHandler;
    public readonly sessionOptions: SessionManagementOptions;
    protected readonly metrics: IMetrics<TMetrics>;
    private readonly pendingInitializations = new Map<string, Promise<void>>();

    constructor({ options, logger, metrics, sessionStore }: MCPHttpServerOptions<TMetrics>) {
        super({
            options: {
                logContext: "mcpHttpServer",
                http: options.http,
            },
            logger,
        });
        this.sessionOptions = options.session;
        this.metrics = metrics;
        this.sessionStore = sessionStore;
        this.modernHandler = this.createModernHandler();
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), this.modernHandler.close(), super.stop()]);
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation.
     */
    protected abstract createServerForRequest(request: TransportRequestContext): Promise<TServer>;

    /**
     * Builds the 2026-07-28 serving entry. One factory backs every request:
     * it constructs a fresh server per request, registers it, and hands the
     * underlying {@link McpServer} to `createMcpHandler`. `legacy: 'reject'`
     * makes the entry strict — 2025-era traffic is routed to the sessionful
     * transport by {@link isLegacyRequest} instead.
     */
    protected createModernHandler(): McpHttpHandler {
        return createMcpHandler(
            async (ctx: McpRequestContext) => {
                const request: TransportRequestContext = {
                    headers: Object.fromEntries(ctx.requestInfo?.headers ?? []),
                    query: ctx.requestInfo?.url
                        ? Object.fromEntries(new URL(ctx.requestInfo.url).searchParams)
                        : undefined,
                };
                return this.createModernServerInstance(request);
            },
            { legacy: "reject" }
        );
    }

    /**
     * Builds a registered {@link McpServer} for one modern (2026-07-28) HTTP
     * request. The default adapts {@link createServerForRequest}; subclasses
     * override when the modern server needs different construction.
     */
    protected async createModernServerInstance(request: TransportRequestContext): Promise<McpServer> {
        const server = await this.createServerForRequest(request);
        await server.register?.();
        return server.mcpServer as unknown as McpServer;
    }

    private reportSessionError(res: express.Response, errorCode: number): void {
        let message: string;
        let statusCode = 400;

        switch (errorCode) {
            case JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED:
                message = "session id is required";
                break;
            case JSON_RPC_ERROR_CODE_SESSION_ID_INVALID:
                message = "session id is invalid";
                break;
            case JSON_RPC_ERROR_CODE_INVALID_REQUEST:
                message = "invalid request";
                break;
            case JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND:
                message = "session not found";
                statusCode = 404;
                break;
            case JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION:
                message = "cannot provide sessionId when externally managed sessions are disabled";
                break;
            case JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED:
                message = "server has reached the maximum number of concurrent sessions, try again later";
                statusCode = 503;
                break;
            default:
                message = "unknown error";
                statusCode = 500;
        }
        res.status(statusCode).json({
            jsonrpc: "2.0",
            error: {
                code: errorCode,
                message,
            },
        });
    }

    private async startKeepAliveLoop({
        transport,
        logger,
        signal,
    }: {
        transport: NodeStreamableHTTPServerTransport;
        logger: ILogger;
        signal: AbortSignal;
    }): Promise<void> {
        if (this.httpOptions.responseType === "json") {
            // Don't start the ping loop for JSON response type since the connection is short-lived and pings aren't needed
            return;
        }

        let failedPings = 0;

        while (!signal.aborted) {
            try {
                logger.debug({
                    id: LogId.streamableHttpTransportKeepAlive,
                    context: "streamableHttpTransport",
                    message: "Sending ping",
                });

                await transport.send({
                    jsonrpc: "2.0",
                    method: "ping",
                });
                failedPings = 0;
            } catch (err) {
                try {
                    failedPings++;
                    logger.warning({
                        id: LogId.streamableHttpTransportKeepAliveFailure,
                        context: "streamableHttpTransport",
                        message: `Error sending ping (attempt #${failedPings}): ${err instanceof Error ? err.message : String(err)}`,
                    });

                    if (failedPings > 3) {
                        await transport.close();
                        return;
                    }
                } catch {
                    // Ignore the error of the transport close
                }
            }

            await sleep(30_000, { signal });
        }
    }

    /**
     * Ensures the session for the given sessionId is initialized, serializing
     * concurrent initialization attempts so only one runs at a time.
     *
     * If a session already exists in the store, this is a no-op.
     * If another request is already initializing this session, this call waits
     * for that initialization to complete.
     * Otherwise, this call performs the initialization.
     *
     * After this method resolves, the caller should look up the transport from
     * the session store via `sessionStore.getSession()`.
     *
     * When `isImplicitInitialization` is true, the transport is pre-configured as
     * initialized (bypassing the MCP initialize handshake) so that it can handle
     * non-initialize requests immediately. When false, the transport is left in
     * its default state so it can process the initialize request normally.
     */
    private async ensureSessionInitialized({
        req,
        sessionId: providedSessionId,
        isImplicitInitialization,
    }: {
        req: express.Request;
        sessionId?: string;
        isImplicitInitialization: boolean;
    }): Promise<string> {
        const sessionId = providedSessionId ?? getRandomUUID();
        const requestIdAttrs = requestIdAttr(req.headers);

        // Check if session already exists
        if (await this.sessionStore.getSession(sessionId, req.headers)) {
            return sessionId;
        }

        // Serialize initializations: if another request is initializing, wait for it
        const pendingInit = this.pendingInitializations.get(sessionId);
        if (pendingInit) {
            this.logger.debug({
                id: LogId.streamableHttpTransportSessionNotFound,
                context: "streamableHttpTransport",
                message: `Session with ID ${sessionId} is already being initialized, waiting`,
                attributes: { ...requestIdAttrs },
            });
            try {
                await pendingInit;
            } catch {
                // The initializer handles its own error
            }
            return sessionId;
        }

        this.logger.debug({
            id: LogId.streamableHttpTransportSessionNotFound,
            context: "streamableHttpTransport",
            message: `Session with ID ${sessionId} not found, initializing new session`,
            attributes: {
                ...requestIdAttrs,
            },
        });

        const initPromise = (async (): Promise<void> => {
            const request: TransportRequestContext = {
                headers: req.headers,
                query: req.query as Record<string, string | string[] | undefined>,
            };

            const server = await this.createServerForRequest(request);

            const transport = new NodeStreamableHTTPServerTransport({
                sessionIdGenerator: (): string => sessionId,
                enableJsonResponse: this.httpOptions.responseType === "json",
                onsessionclosed: async (sessionId): Promise<void> => {
                    try {
                        await this.sessionStore.closeSession({ sessionId, reason: "transport_closed" });
                    } catch (error) {
                        this.logger.error({
                            id: LogId.sessionCloseFailure,
                            context: "streamableHttpTransport",
                            message: `Error closing session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                },
            });

            // HACK: When we're implicitly initializing the session, we want to configure the session id and _initialized flag on the transport
            // so that it believes it actually went through the initialization flow. Without it, we'd get errors like "transport not initialized"
            // when we try to use it without initialize request
            if (isImplicitInitialization) {
                const internalTransport = transport["_webStandardTransport"] as {
                    _initialized: boolean;
                    sessionId: string;
                };
                internalTransport._initialized = true;
                internalTransport.sessionId = sessionId;
            }

            server.session?.logger.setAttribute("sessionId", sessionId);

            const keepAliveController = new AbortController();
            void this.startKeepAliveLoop({
                transport,
                logger: server.session?.logger ?? this.logger,
                signal: keepAliveController.signal,
            });
            transport.onclose = (): void => {
                keepAliveController.abort();

                server.close().catch((error: unknown) => {
                    this.logger.error({
                        id: LogId.streamableHttpTransportCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing server: ${error instanceof Error ? error.message : String(error)}`,
                    });
                });
            };

            await server.connect(transport);

            if (isImplicitInitialization) {
                await this.restoreNegotiatedClientState(server, sessionId, req.headers);
            } else {
                this.captureNegotiatedClientStateOnInitialize(server, sessionId, req.headers);
            }

            await this.sessionStore.addSession({
                sessionId,
                transport,
                logger: server.session?.logger ?? this.logger,
                session: server.session,
                // Pass the incoming request headers to the session store so
                // that we can trace the x-request-id and other headers in the
                // resulting logs and downstream requests.
                headers: req.headers,
            });
        })();

        this.pendingInitializations.set(sessionId, initPromise);
        try {
            await initPromise;
        } catch (error) {
            this.logger.error({
                id: LogId.streamableHttpTransportRequestFailure,
                context: "streamableHttpTransport",
                message: `Failed to initialize session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                attributes: { ...requestIdAttrs },
            });
            // Remove the partially initialized session on failure so that
            // subsequent requests don't see a broken session and can retry
            try {
                await this.sessionStore.closeSession({ sessionId, reason: "unknown" });
            } catch {
                // Session might not be in the store, that's fine
            }
            throw error;
        } finally {
            this.pendingInitializations.delete(sessionId);
        }
        return sessionId;
    }

    /**
     * Restores the client state negotiated during the session's original
     * initialization onto an implicitly re-initialized server. The server on
     * this pod never saw the client's `initialize` request, so without this
     * it would treat the client as capability-less — e.g. skipping
     * confirmation elicitation for destructive tools. No-op when the session
     * store does not persist negotiated client state.
     */
    private async restoreNegotiatedClientState(
        server: TServer,
        sessionId: string,
        headers: Record<string, unknown>
    ): Promise<void> {
        let state: NegotiatedClientState | undefined;
        try {
            state = await this.sessionStore.loadNegotiatedClientState(sessionId, headers);
        } catch (error) {
            // The restored session stays usable; it just behaves as if the
            // client had no optional capabilities.
            this.logger.warning({
                id: LogId.streamableHttpTransportClientStateRestoreFailure,
                context: "streamableHttpTransport",
                message: `Failed to restore negotiated client state for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                attributes: { ...requestIdAttr(headers) },
            });
            return;
        }
        if (!state) {
            return;
        }

        // HACK: like the transport `_initialized` flag above, the SDK offers
        // no supported way to seed a Server with a previously negotiated
        // initialization, so we write the private fields the initialize
        // handler would have populated.
        const mcpServer = server.mcpServer;
        const protocolServer = mcpServer.server as unknown as {
            _clientCapabilities?: ClientCapabilities;
            _clientVersion?: Implementation;
        };
        protocolServer._clientCapabilities = state.clientCapabilities;
        protocolServer._clientVersion = state.clientInfo;
        server.session.setMcpClient(state.clientInfo);
    }

    /**
     * Arranges for the client state negotiated by a real `initialize`
     * exchange to be persisted through the session store, so implicit
     * re-initializations of this session can restore it. Wraps the
     * `oninitialized` callback installed by `server.connect`, hence must run
     * after it.
     */
    private captureNegotiatedClientStateOnInitialize(
        server: TServer,
        sessionId: string,
        headers: Record<string, unknown>
    ): void {
        const protocolServer = server.mcpServer.server;
        const originalOnInitialized = protocolServer.oninitialized;
        protocolServer.oninitialized = (): void => {
            originalOnInitialized?.();

            const state: NegotiatedClientState = {
                clientCapabilities: protocolServer.getClientCapabilities(),
                clientInfo: protocolServer.getClientVersion(),
            };
            this.sessionStore.saveNegotiatedClientState(sessionId, state, headers).catch((error: unknown) => {
                this.logger.warning({
                    id: LogId.streamableHttpTransportClientStateSaveFailure,
                    context: "streamableHttpTransport",
                    message: `Failed to save negotiated client state for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    attributes: { ...requestIdAttr(headers) },
                });
            });
        };
    }

    protected setupMiddlewares(): void {
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
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- Required for override signature
    protected override async setupRoutes(): Promise<void> {
        this.setupMiddlewares();

        const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
            const sessionId = req.headers["mcp-session-id"];
            if (!sessionId) {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED);
            }

            if (typeof sessionId !== "string") {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            }

            const requestIdAttrs = requestIdAttr(req.headers);

            let transport = await this.sessionStore.getSession(sessionId, req.headers);
            if (!transport) {
                if (!this.sessionOptions.externallyManagedSessions) {
                    this.logger.debug({
                        id: LogId.streamableHttpTransportSessionNotFound,
                        context: "streamableHttpTransport",
                        message: `Session with ID ${sessionId} not found`,
                        attributes: { ...requestIdAttrs },
                    });
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                }

                const resolvedSessionId = await this.ensureSessionInitialized({
                    req,
                    sessionId,
                    isImplicitInitialization: true,
                });
                transport = await this.sessionStore.getSession(resolvedSessionId, req.headers);
                if (!transport) {
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                }
            }

            await transport.handleRequest(req, res, req.body);
        };

        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
                // Modern (2026-07-28) requests carry the per-request `_meta`
                // envelope claim; the sessionful transport serves only the
                // 2025-era protocol, so route those to the modern handler.
                const webRequest = await toWebRequest(req, req.body);
                if (!(await isLegacyRequest(webRequest, req.body))) {
                    await toNodeHandler({ fetch: (request, opts) => this.modernHandler.fetch(request, opts) })(
                        req,
                        res,
                        req.body
                    );
                    return;
                }

                const sessionId = req.headers["mcp-session-id"];
                if (sessionId && typeof sessionId !== "string") {
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
                }

                if (isInitializeRequest(req.body)) {
                    if (sessionId && !this.sessionOptions.externallyManagedSessions) {
                        this.logger.debug({
                            id: LogId.streamableHttpTransportDisallowedExternalSessionError,
                            context: "streamableHttpTransport",
                            message: `Client provided session ID ${sessionId}, but externallyManagedSessions is disabled`,
                            attributes: requestIdAttr(req.headers),
                        });
                        return this.reportSessionError(res, JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION);
                    }

                    const resolvedSessionId = await this.ensureSessionInitialized({
                        req,
                        sessionId,
                        isImplicitInitialization: false,
                    });
                    const transport = await this.sessionStore.getSession(resolvedSessionId, req.headers);
                    if (!transport) {
                        return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                    }
                    await transport.handleRequest(req, res, req.body);
                    return;
                }

                if (sessionId) {
                    return await handleSessionRequest(req, res);
                }

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_INVALID_REQUEST);
            })
        );

        this.app.get(
            "/mcp",
            this.withErrorHandling(async (req, res): Promise<void> => {
                if (this.httpOptions.responseType === "sse") {
                    await handleSessionRequest(req, res);
                } else {
                    res.status(405).set("Allow", ["POST", "DELETE"]).send("Method Not Allowed");
                }
            })
        );

        this.app.delete("/mcp", this.withErrorHandling(handleSessionRequest));
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
                    attributes: requestIdAttr(req.headers),
                });

                if (error instanceof SessionRejectedError) {
                    // Respond exactly as if the session doesn't exist so that
                    // callers can't probe whether a session id is valid; the
                    // rejection reason is only visible in the log above.
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                }

                if (error instanceof SessionLimitExceededError) {
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_LIMIT_EXCEEDED);
                }

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
