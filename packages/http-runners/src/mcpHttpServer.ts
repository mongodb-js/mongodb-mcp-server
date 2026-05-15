import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
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
} from "@mongodb-js/mcp-types";
import {
    LogId,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    UserFacingError,
    getRandomUUID,
} from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import { sleep } from "./utils.js";

/**
 * Minimum server interface required by MCPHttpServer.
 * Servers must have connect/close methods and a session with a logger for HTTP transport functionality.
 */
export type SessionAwareServer = {
    connect(transport: StreamableHTTPServerTransport): Promise<void>;
    close(): Promise<void>;
    session: { logger: ICompositeLogger };
};

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
    sessionStore: ISessionStore<StreamableHTTPServerTransport>;
};

/**
 * HTTP server that handles MCP requests over HTTP using the Streamable HTTP transport.
 *
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
    TServer extends SessionAwareServer = SessionAwareServer,
    TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions,
> extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
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
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation.
     */
    protected abstract createServerForRequest(request: TransportRequestContext): Promise<TServer>;

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
        transport: StreamableHTTPServerTransport;
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

        if (await this.sessionStore.getSession(sessionId)) {
            return sessionId;
        }

        // Serialize initializations: if another request is initializing, wait for it
        const pendingInit = this.pendingInitializations.get(sessionId);
        if (pendingInit) {
            this.logger.debug({
                id: LogId.streamableHttpTransportSessionNotFound,
                context: "streamableHttpTransport",
                message: `Session with ID ${sessionId} is already being initialized, waiting`,
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
        });

        const initPromise = (async (): Promise<void> => {
            const request: TransportRequestContext = {
                headers: req.headers,
                query: req.query as Record<string, string | string[] | undefined>,
            };

            const server = await this.createServerForRequest(request);

            const transport = new StreamableHTTPServerTransport({
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

            await this.sessionStore.addSession({
                sessionId,
                transport,
                logger: server.session?.logger ?? this.logger,
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

            let transport = await this.sessionStore.getSession(sessionId);
            if (!transport) {
                if (!this.sessionOptions.externallyManagedSessions) {
                    this.logger.debug({
                        id: LogId.streamableHttpTransportSessionNotFound,
                        context: "streamableHttpTransport",
                        message: `Session with ID ${sessionId} not found`,
                    });
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                }

                const resolvedSessionId = await this.ensureSessionInitialized({
                    req,
                    sessionId,
                    isImplicitInitialization: true,
                });
                transport = await this.sessionStore.getSession(resolvedSessionId);
                if (!transport) {
                    return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
                }
            }

            await transport.handleRequest(req, res, req.body);
        };

        this.app.post(
            "/mcp",
            this.withErrorHandling(async (req: express.Request, res: express.Response) => {
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
                        });
                        return this.reportSessionError(res, JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION);
                    }

                    const resolvedSessionId = await this.ensureSessionInitialized({
                        req,
                        sessionId,
                        isImplicitInitialization: false,
                    });
                    const transport = await this.sessionStore.getSession(resolvedSessionId);
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
