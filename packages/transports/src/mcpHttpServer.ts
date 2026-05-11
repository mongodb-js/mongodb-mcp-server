import { type StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { LogId } from "@mongodb-js/mcp-logging";
import { getRandomUUID } from "../helpers/getRandomUUID.js";
import {
    type UserConfig,
    type ISessionStore,
    type Metrics,
    type DefaultMetrics,
    type Server,
    type LoggerBase,
} from "../lib.js";
import { ConfigOverrideError } from "../common/config/configOverrides.js";
import type { CustomizableServerOptions, CustomizableSessionOptions, TransportRequestContext } from "./base.js";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import {
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
} from "./jsonRpcErrorCodes.js";

export type MCPHttpServerConstructorArgs<TUserConfig extends UserConfig = UserConfig, TContext = unknown> = {
    userConfig: TUserConfig;
    createServerForRequest: (createParams: {
        request: TransportRequestContext;
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    }) => Promise<Server<TUserConfig, TContext>>;
    logger: LoggerBase;
    serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    metrics: Metrics<DefaultMetrics>;
    sessionStore: ISessionStore<StreamableHTTPServerTransport>;
};

export class MCPHttpServer<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
> extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    private readonly serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    private readonly sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    protected readonly userConfig: TUserConfig;
    private readonly metrics: Metrics<DefaultMetrics>;
    private readonly pendingInitializations = new Map<string, Promise<void>>();

    private createServerForRequest: (createParams: {
        request: TransportRequestContext;
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    }) => Promise<Server<TUserConfig, TContext>>;

    constructor({
        userConfig,
        createServerForRequest,
        serverOptions,
        sessionOptions,
        logger,
        metrics,
        sessionStore,
    }: MCPHttpServerConstructorArgs<TUserConfig, TContext>) {
        super({
            port: userConfig.httpPort,
            hostname: userConfig.httpHost,
            logger,
            logContext: "mcpHttpServer",
        });
        this.serverOptions = serverOptions;
        this.sessionOptions = sessionOptions;
        this.createServerForRequest = createServerForRequest;
        this.userConfig = userConfig;
        this.metrics = metrics;
        this.sessionStore = sessionStore;
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
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
        server: Server<TUserConfig, TContext>
    ): NodeJS.Timeout | undefined {
        if (this.userConfig.httpResponseType === "json") {
            // Don't start the ping loop for JSON response type since the connection is short-lived and pings aren't needed
            return undefined;
        }

        let failedPings = 0;
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        const keepAliveLoop = setInterval(async () => {
            try {
                server.session.logger.debug({
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
                    server.session.logger.warning({
                        id: LogId.streamableHttpTransportKeepAliveFailure,
                        context: "streamableHttpTransport",
                        message: `Error sending ping (attempt #${failedPings}): ${err instanceof Error ? err.message : String(err)}`,
                    });

                    if (failedPings > 3) {
                        clearInterval(keepAliveLoop);
                        await transport.close();
                    }
                } catch {
                    // Ignore the error of the transport close as there's nothing else
                    // we can do at this point.
                }
            }
        }, 30_000);

        return keepAliveLoop;
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
        /** StreamableHTTPTransport needs to be imported dynamically as it uses Node-specific APIs */
        const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

        const sessionId = providedSessionId ?? getRandomUUID();

        // Check if session already exists
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
                // The initializer handles its own error; we just need to
                // let the caller re-check the store.
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
            const server = await this.createServerForRequest({
                request,
                serverOptions: this.serverOptions,
                sessionOptions: this.sessionOptions,
            });

            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: (): string => sessionId,
                enableJsonResponse: this.userConfig.httpResponseType === "json",
                onsessionclosed: async (sessionId): Promise<void> => {
                    try {
                        await this.sessionStore.closeSession({ sessionId, reason: "transport_closed" });
                    } catch (error) {
                        this.logger.error({
                            id: LogId.streamableHttpTransportSessionCloseFailure,
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

            server.session.logger.setAttribute("sessionId", sessionId);

            const keepAliveLoop = this.startKeepAliveLoop(transport, server);
            transport.onclose = (): void => {
                clearInterval(keepAliveLoop);

                server.close().catch((error) => {
                    this.logger.error({
                        id: LogId.streamableHttpTransportCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing server: ${error instanceof Error ? error.message : String(error)}`,
                    });
                });
            };

            await server.connect(transport);

            await this.sessionStore.addSession({ sessionId, transport, logger: server.session.logger });
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
        this.app.use(express.json({ limit: this.userConfig.httpBodyLimit }));
        this.app.use((req, res, next) => {
            for (const [key, value] of Object.entries(this.userConfig.httpHeaders)) {
                const header = req.headers[key.toLowerCase()];
                if (!header || header !== value) {
                    res.status(403).json({ error: `Invalid value for header "${key}"` });
                    return;
                }
            }

            next();
        });
    }

    // eslint-disable-next-line @typescript-eslint/require-await
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
                if (!this.userConfig.externallyManagedSessions) {
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
                    if (sessionId && !this.userConfig.externallyManagedSessions) {
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
                if (this.userConfig.httpResponseType === "sse") {
                    await handleSessionRequest(req, res);
                } else {
                    // Don't allow SSE upgrades if the response type is JSON
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

                const message = error instanceof ConfigOverrideError ? error.message : `failed to handle request`;

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
 * A function to create a custom MCPHttpServer instance.
 * When provided, the runner will use this function instead of the default MCPHttpServer constructor.
 */
export type CreateMcpHttpServerFn<TUserConfig extends UserConfig = UserConfig, TContext = unknown> = (
    args: MCPHttpServerConstructorArgs<TUserConfig, TContext>
) => MCPHttpServer<TUserConfig, TContext>;

/**
 * Creates a default MCPHttpServer instance from the provided constructor arguments.
 */
export const createDefaultMcpHttpServer = <TUserConfig extends UserConfig = UserConfig, TContext = unknown>(
    args: MCPHttpServerConstructorArgs<TUserConfig, TContext>
): MCPHttpServer<TUserConfig, TContext> => new MCPHttpServer<TUserConfig, TContext>(args);
