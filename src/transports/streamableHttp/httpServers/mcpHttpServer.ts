import express from "express";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { WebStandardStreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { Server } from "../../../server.js";
import { SessionStore } from "../../../common/sessionStore.js";
import { getRandomUUID } from "../../../helpers/getRandomUUID.js";
import { ExpressBasedHttpServer } from "./expressBasedHttpServer.js";
import type { UserConfig } from "../../../common/config/userConfig.js";
import { type LoggerBase, LogId } from "../../../common/logging/index.js";
import type { CustomizableServerOptions, CustomizableSessionOptions, RequestContext } from "../../base.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;

export class MCPHttpServer<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
> extends ExpressBasedHttpServer {
    private sessionStore!: SessionStore<StreamableHTTPServerTransport>;
    private serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    private sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    private userConfig: UserConfig;

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
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    protected override async setupRoutes(): Promise<void> {
        this.sessionStore = new SessionStore(
            this.userConfig.idleTimeoutMs,
            this.userConfig.notificationTimeoutMs,
            this.logger
        );

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

                    return await this.initializeServer(req, res, { sessionId });
                }

                if (sessionId) {
                    return await this.handleSessionRequest(req, res);
                }

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_INVALID_REQUEST);
            })
        );

        this.app.get("/mcp", this.withErrorHandling(this.handleSessionRequest.bind(this)));
        this.app.delete("/mcp", this.withErrorHandling(this.handleSessionRequest.bind(this)));
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

    private async handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
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

                return await this.initializeServer(req, res, { sessionId, isImplicitInitialization: true });
            }

            this.logger.debug({
                id: LogId.streamableHttpTransportSessionNotFound,
                context: "streamableHttpTransport",
                message: `Session with ID ${sessionId} not found`,
            });

            return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
        }

        await transport.handleRequest(req, res, req.body);
    }

    /**
     * Initializes a new server and session. This can be done either explicitly via an initialize request
     * or implicitly when externally managed sessions are enabled and a request is received for a session
     * that does not exist.
     */
    private async initializeServer(
        req: express.Request,
        res: express.Response,
        {
            sessionId,
            isImplicitInitialization,
        }:
            | { sessionId?: string; isImplicitInitialization?: false }
            | { sessionId: string; isImplicitInitialization: true }
    ): Promise<void> {
        const { StreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
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

        const options: WebStandardStreamableHTTPServerTransportOptions = {
            enableJsonResponse: this.userConfig.httpResponseType === "json",
        };

        const sessionInitialized = (sessionId: string): void => {
            server.session.logger.setAttribute("sessionId", sessionId);

            this.sessionStore.setSession(sessionId, transport, server.session.logger);
            server.session.logger.info({
                id: LogId.streamableHttpTransportSessionInitialized,
                context: "streamableHttpTransport",
                message: `Session ${sessionId} initialized, response type: ${options.enableJsonResponse ? "JSON" : "SSE"}`,
            });
        };

        // When we're implicitly initializing a session, the client is not going through the initialization
        // flow. This means that it won't do proper session lifecycle management, so we should not add hooks for
        // onsessioninitialized and onsessionclosed.
        if (!isImplicitInitialization) {
            options.sessionIdGenerator = (): string => sessionId ?? getRandomUUID();
            options.onsessioninitialized = sessionInitialized.bind(this);
            options.onsessionclosed = async (sessionId): Promise<void> => {
                try {
                    await this.sessionStore.closeSession(sessionId, false);
                } catch (error) {
                    this.logger.error({
                        id: LogId.streamableHttpTransportSessionCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            };
        }

        const transport = new StreamableHTTPServerTransport(options);

        let failedPings = 0;
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        const keepAliveLoop: NodeJS.Timeout = setInterval(async () => {
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

        if (isImplicitInitialization) {
            sessionInitialized(sessionId);
        }

        await transport.handleRequest(req, res, req.body);
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
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
                        message: `failed to handle request`,
                        data: error instanceof Error ? error.message : String(error),
                    },
                });
            });
        };
    }
}
