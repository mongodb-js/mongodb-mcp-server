import type {
    StreamableHTTPServerTransport,
    StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { LogId } from "../common/logging/loggingDefinitions.js";
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
import type { CustomizableServerOptions, CustomizableSessionOptions, RequestContext } from "./base.js";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import {
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
} from "./jsonRpcErrorCodes.js";

export class MCPHttpServer<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
> extends ExpressBasedHttpServer {
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    private readonly serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    private readonly sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    private readonly userConfig: UserConfig;
    private readonly metrics: Metrics<DefaultMetrics>;

    private createServerForRequest: (createParams: {
        request: RequestContext;
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
    }: {
        userConfig: TUserConfig;
        createServerForRequest: (createParams: {
            request: RequestContext;
            serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
            sessionOptions?: CustomizableSessionOptions<TUserConfig>;
        }) => Promise<Server<TUserConfig, TContext>>;
        logger: LoggerBase;
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
        metrics: Metrics<DefaultMetrics>;
        sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    }) {
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

    protected override async setupRoutes(): Promise<void> {
        const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

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

        const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
            const sessionId = req.headers["mcp-session-id"];
            if (!sessionId) {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED);
            }

            if (typeof sessionId !== "string") {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            }

            const transport = this.sessionStore.getSession(sessionId);
            if (!transport) {
                if (this.userConfig.externallyManagedSessions) {
                    this.logger.debug({
                        id: LogId.streamableHttpTransportSessionNotFound,
                        context: "streamableHttpTransport",
                        message: `Session with ID ${sessionId} not found, initializing new session`,
                    });

                    return await initializeServer(req, res, { sessionId, isImplicitInitialization: true });
                }

                this.logger.debug({
                    id: LogId.streamableHttpTransportSessionNotFound,
                    context: "streamableHttpTransport",
                    message: `Session with ID ${sessionId} not found`,
                });

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
            }

            await transport.handleRequest(req, res, req.body);
        };

        /**
         * Initializes a new server and session. This can be done either explicitly via an initialize request
         * or implicitly when externally managed sessions are enabled and a request is received for a session
         * that does not exist.
         */
        const initializeServer = async (
            req: express.Request,
            res: express.Response,
            {
                sessionId,
                isImplicitInitialization,
            }:
                | { sessionId?: string; isImplicitInitialization?: false }
                | { sessionId: string; isImplicitInitialization: true }
        ): Promise<void> => {
            if (isImplicitInitialization && !sessionId) {
                throw new Error("Implicit initialization requires externally-passed sessionId");
            }

            const request: RequestContext = {
                headers: req.headers as Record<string, string | string[] | undefined>,
                query: req.query as Record<string, string | string[] | undefined>,
            };
            const server = await this.createServerForRequest({
                request,
                serverOptions: this.serverOptions,
                sessionOptions: this.sessionOptions,
            });

            sessionId = sessionId ?? getRandomUUID();
            const options: StreamableHTTPServerTransportOptions = {
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
            };

            const transport = new StreamableHTTPServerTransport(options);
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

            // This is eagerly setting the session in the session store to ensure that follow-up requests
            // reuse it. This may cause issues if server.connect fails as we'll try to use a transport that's
            // not fully set up.
            server.session.logger.setAttribute("sessionId", sessionId);
            this.sessionStore.addSession({ sessionId, transport, logger: server.session.logger });

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

                    return await initializeServer(req, res, { sessionId, isImplicitInitialization: false });
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
