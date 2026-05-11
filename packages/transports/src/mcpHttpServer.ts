import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type {
    ILogger,
    ICompositeLogger,
    IMetrics,
    MetricDefinitions,
    TransportRequestContext,
    ISessionStore,
    HttpServerConfig,
    SessionManagementConfig,
} from "@mongodb-js/mcp-types";
import { LogId } from "@mongodb-js/mcp-core";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import {
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
} from "./jsonRpcErrorCodes.js";

/**
 * Options for creating an MCPHttpServer instance.
 */
export type MCPHttpServerOptions<
    TServer = unknown,
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> = {
    /** HTTP server configuration */
    httpOptions: HttpServerConfig;
    /** Session management configuration */
    sessionOptions: SessionManagementConfig;
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
 * To customize server creation, extend this class and override the `createServer()` method:
 *
 * @example
 * ```typescript
 * class MyMCPHttpServer extends MCPHttpServer {
 *   protected override async createServer(): Promise<MyServer> {
 *     return new MyServer({ ... });
 *   }
 * }
 * ```
 */
export class MCPHttpServer<
    TServer = unknown,
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    public readonly httpConfig: HttpServerConfig;
    public readonly sessionConfig: SessionManagementConfig;
    protected readonly metrics: IMetrics<TMetrics>;
    private readonly pendingInitializations = new Map<string, Promise<void>>();

    constructor({
        httpOptions,
        sessionOptions,
        logger,
        metrics,
        sessionStore,
    }: MCPHttpServerOptions<TServer, TContext, TMetrics>) {
        super({
            port: httpOptions.port,
            hostname: httpOptions.host,
            logger,
            logContext: "mcpHttpServer",
        });
        this.httpConfig = httpOptions;
        this.sessionConfig = sessionOptions;
        this.metrics = metrics;
        this.sessionStore = sessionStore;
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
    }

    /**
     * Creates a new server instance. Override this method in subclasses
     * to customize server creation for each new session.
     */
    protected async createServer(): Promise<TServer> {
        throw new Error("MCPHttpServer.createServer() must be overridden in a subclass");
    }

    /**
     * Creates a server instance for a specific request. Override this method
     * in subclasses to customize per-request server creation. The default
     * implementation delegates to createServer().
     */
    protected async createServerForRequest(request: TransportRequestContext): Promise<TServer> {
        return this.createServer();
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

    private startKeepAliveLoop(
        transport: StreamableHTTPServerTransport,
        server: TServer & { session?: { logger: ILogger } }
    ): NodeJS.Timeout | undefined {
        if (this.httpConfig.responseType === "json") {
            return undefined;
        }

        let failedPings = 0;
        const keepAliveLoop = setInterval(async () => {
            try {
                server.session?.logger.debug({
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
                    server.session?.logger.warning({
                        id: LogId.streamableHttpTransportKeepAliveFailure,
                        context: "streamableHttpTransport",
                        message: `Error sending ping (attempt #${failedPings}): ${err instanceof Error ? err.message : String(err)}`,
                    });

                    if (failedPings > 3) {
                        clearInterval(keepAliveLoop);
                        await transport.close();
                    }
                } catch {
                    // Ignore the error of the transport close
                }
            }
        }, 30_000);

        return keepAliveLoop;
    }

    private getRandomUUID(): string {
        return crypto.randomUUID();
    }

    private async ensureSessionInitialized({
        req,
        sessionId: providedSessionId,
        isImplicitInitialization,
    }: {
        req: express.Request;
        sessionId?: string;
        isImplicitInitialization: boolean;
    }): Promise<string> {
        const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

        const sessionId = providedSessionId ?? this.getRandomUUID();

        if (await this.sessionStore.getSession(sessionId)) {
            return sessionId;
        }

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
                headers: req.headers as Record<string, string | string[] | undefined>,
                query: req.query as Record<string, string | string[] | undefined>,
            };

            // Use createServerForRequest to create server for this request
            const server = await this.createServerForRequest(request);

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: (): string => sessionId,
                enableJsonResponse: this.httpConfig.responseType === "json",
                onsessionclosed: async (sid): Promise<void> => {
                    try {
                        await this.sessionStore.closeSession({ sessionId: sid, reason: "transport_closed" });
                    } catch (error) {
                        this.logger.error({
                            id: LogId.streamableHttpTransportSessionCloseFailure,
                            context: "streamableHttpTransport",
                            message: `Error closing session ${sid}: ${error instanceof Error ? error.message : String(error)}`,
                        });
                    }
                },
            });

            if (isImplicitInitialization) {
                const internalTransport = transport["_webStandardTransport"] as {
                    _initialized: boolean;
                    sessionId: string;
                };
                internalTransport._initialized = true;
                internalTransport.sessionId = sessionId;
            }

            const serverWithLogger = server as { session?: { logger: ICompositeLogger } };
            serverWithLogger.session?.logger.setAttribute("sessionId", sessionId);

            const keepAliveLoop = this.startKeepAliveLoop(
                transport,
                server as TServer & { session?: { logger: ILogger } }
            );
            transport.onclose = (): void => {
                clearInterval(keepAliveLoop);

                const serverWithClose = server as { close(): Promise<void> };
                serverWithClose.close?.().catch((error: unknown) => {
                    this.logger.error({
                        id: LogId.streamableHttpTransportCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing server: ${error instanceof Error ? error.message : String(error)}`,
                    });
                });
            };

            const serverWithConnect = server as { connect(transport: StreamableHTTPServerTransport): Promise<void> };
            await serverWithConnect.connect(transport);

            await this.sessionStore.addSession({
                sessionId,
                transport,
                logger: serverWithLogger.session?.logger ?? this.logger,
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
            try {
                await this.sessionStore.closeSession({ sessionId, reason: "unknown" });
            } catch {
                // Session might not be in the store
            }
            throw error;
        } finally {
            this.pendingInitializations.delete(sessionId);
        }
        return sessionId;
    }

    protected setupMiddlewares(): void {
        this.app.use(express.json({ limit: this.httpConfig.bodyLimit ?? 1024 * 1024 }));

        const headers = this.httpConfig.headers;
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
                if (!this.sessionConfig.externallyManagedSessions) {
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
                    if (sessionId && !this.sessionConfig.externallyManagedSessions) {
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
                if (this.httpConfig.responseType === "sse") {
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
                this.logger.error({
                    id: LogId.streamableHttpTransportRequestFailure,
                    context: "streamableHttpTransport",
                    message: `Error handling request: ${error instanceof Error ? error.message : String(error)}`,
                });

                const message = `failed to handle request`;

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

/**
 * Creates a default MCPHttpServer instance from the provided constructor arguments.
 * @deprecated Use `new MCPHttpServer()` directly instead. This factory function will be removed in a future version.
 */
export const createDefaultMcpHttpServer = <
    TServer = unknown,
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
>(
    args: MCPHttpServerOptions<TServer, TContext, TMetrics>
): MCPHttpServer<TServer, TContext, TMetrics> => new MCPHttpServer<TServer, TContext, TMetrics>(args);
