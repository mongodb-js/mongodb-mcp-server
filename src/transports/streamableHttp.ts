import express from "express";
import type http from "http";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { LoggerBase } from "../common/logging/index.js";
import { CompositeLogger, LogId } from "../common/logging/index.js";
import { SessionStore } from "../common/sessionStore.js";
import {
    TransportRunnerBase,
    type TransportRunnerConfig,
    type RequestContext,
    type CustomizableSessionOptions,
} from "./base.js";
import { getRandomUUID } from "../helpers/getRandomUUID.js";
import type { CustomizableServerOptions, Server, UserConfig } from "../lib.js";
import type { WebStandardStreamableHTTPServerTransportOptions } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { applyConfigOverrides } from "../common/config/configOverrides.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;
const JSON_RPC_ERROR_CODE_TRANSPORT_MISSING = -32006;

export class StreamableHttpRunner<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
> extends TransportRunnerBase<TUserConfig, TContext> {
    private mcpServer: MCPHttpServer<TUserConfig, TContext> | undefined;
    private healthCheckServer: HealthCheckServer | undefined;

    constructor(config: TransportRunnerConfig<TUserConfig>) {
        super(config);
    }

    /** Starts the transport runner. */
    async start({
        serverOptions,
        sessionOptions,
    }: {
        /** Server options to use when creating the server. */
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        /** Session options to use when creating the session. */
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    } = {}): Promise<void> {
        this.validateConfig();

        await this.startMCPServer({ serverOptions, sessionOptions });
        await this.startHealthCheckServer();

        this.logger.info({
            message: "Streamable HTTP Transport started",
            context: "streamableHttpTransport",
            id: LogId.streamableHttpTransportStarted,
        });
    }

    async closeTransport(): Promise<void> {
        await Promise.all([this.mcpServer?.stop(), this.healthCheckServer?.stop()]);
    }

    private shouldWarnAboutHttpHost(httpHost: string): boolean {
        const host = httpHost.trim();
        const safeHosts = new Set(["127.0.0.1", "localhost", "::1"]);
        return host === "0.0.0.0" || host === "::" || (!safeHosts.has(host) && host !== "");
    }

    /**
     * Creates a new MCP server instance for a given request.
     */
    protected async createServerForRequest({
        request,
        serverOptions,
        sessionOptions,
    }: {
        request: RequestContext;
        /** Upstream `serverOptions` passed from running `runner.start({ serverOptions })` method */
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        /** Upstream `sessionOptions` passed from running `runner.start({ sessionOptions })` method */
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    }): Promise<Server<TUserConfig, TContext>> {
        let userConfig: TUserConfig = sessionOptions?.userConfig ?? this.userConfig;

        if (this.createSessionConfig) {
            userConfig = await this.createSessionConfig({ userConfig, request });
        } else {
            userConfig = applyConfigOverrides({ baseConfig: userConfig, request });
        }

        const logger = new CompositeLogger(this.logger);

        return this.createServer({
            userConfig,
            logger,
            serverOptions: {
                tools: this.tools,
                ...serverOptions,
            },
            sessionOptions: {
                ...sessionOptions,
                connectionErrorHandler: sessionOptions?.connectionErrorHandler ?? this.connectionErrorHandler,
                connectionManager:
                    sessionOptions?.connectionManager ??
                    (await this.createConnectionManager({
                        logger,
                        deviceId: this.deviceId,
                        userConfig,
                    })),
                atlasLocalClient: sessionOptions?.atlasLocalClient ?? (await this.createAtlasLocalClient({ logger })),
                apiClient:
                    sessionOptions?.apiClient ??
                    (userConfig.apiClientId && userConfig.apiClientSecret
                        ? this.createApiClient(
                              {
                                  baseUrl: userConfig.apiBaseUrl,
                                  credentials: {
                                      clientId: userConfig.apiClientId,
                                      clientSecret: userConfig.apiClientSecret,
                                  },
                                  requestContext: request,
                              },
                              logger
                          )
                        : undefined),
            },
        });
    }

    private async startMCPServer({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    }): Promise<void> {
        const args: MCPHttpServerConfig<TUserConfig, TContext> = {
            userConfig: this.userConfig,
            serverOptions,
            sessionOptions,
            createServerForRequest: ({
                request,
                serverOptions: requestServerOptions,
                sessionOptions: requestSessionOptions,
            }): Promise<Server<TUserConfig, TContext>> =>
                this.createServerForRequest({
                    request,
                    serverOptions: requestServerOptions,
                    sessionOptions: requestSessionOptions,
                }),
            logger: this.logger,
        };

        this.mcpServer = new MCPHttpServer(args);
        await this.mcpServer.start();
    }

    private async startHealthCheckServer(): Promise<void> {
        const { healthCheckHost, healthCheckPort } = this.userConfig;
        if (healthCheckHost && healthCheckPort !== undefined) {
            this.healthCheckServer = new HealthCheckServer(healthCheckHost, healthCheckPort, this.logger);

            await this.healthCheckServer.start();
        }
    }

    private validateConfig(): void {
        if ((this.userConfig.healthCheckHost === undefined) !== (this.userConfig.healthCheckPort === undefined)) {
            throw new Error("Both healthCheckHost and healthCheckPort must be defined to enable health checks.");
        }

        if (this.userConfig.healthCheckHost !== undefined && this.userConfig.healthCheckPort !== undefined) {
            if (this.userConfig.healthCheckPort === this.userConfig.httpPort && this.userConfig.healthCheckPort !== 0) {
                throw new Error("healthCheckPort cannot be the same as httpPort.");
            }
        }

        if (this.shouldWarnAboutHttpHost(this.userConfig.httpHost)) {
            this.logger.warning({
                id: LogId.streamableHttpTransportHttpHostWarning,
                context: "streamableHttpTransport",
                message: `Binding to ${this.userConfig.httpHost} can expose the MCP Server to the entire local network, which allows other devices on the same network to potentially access the MCP Server. This is a security risk and could allow unauthorized access to your database context.`,
                noRedaction: true,
            });
        }
    }
}

type ExpressConfig = {
    port: number;
    hostname: string;
};

abstract class ExpressBasedHttpServer {
    protected httpServer: http.Server | undefined;
    protected app: express.Express;

    protected readonly logger: LoggerBase;
    protected readonly logContext: string;

    protected readonly expressConfig: ExpressConfig;

    constructor(config: { logger: LoggerBase; logContext: string } & ExpressConfig) {
        this.app = express();
        this.app.enable("trust proxy"); // needed for reverse proxy support
        this.expressConfig = { port: config.port, hostname: config.hostname };

        this.logger = config.logger;
        this.logContext = config.logContext;
    }

    public get serverAddress(): string {
        const result = this.httpServer?.address();
        if (typeof result === "string") {
            return result;
        }
        if (typeof result === "object" && result) {
            return `http://${result.address}:${result.port}`;
        }

        throw new Error("Server is not started yet");
    }

    protected abstract setupRoutes(): Promise<void> | void;

    public async start(): Promise<void> {
        await this.setupRoutes();

        const { port, hostname } = this.expressConfig;

        this.httpServer = await new Promise<http.Server>((resolve, reject) => {
            const result = this.app.listen(port, hostname, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        this.logger.info({
            message: `Http server started on address: ${this.serverAddress}`,
            context: this.logContext,
            noRedaction: true,
            id: LogId.httpServerStarted,
        });
    }

    public async stop(): Promise<void> {
        if (this.httpServer) {
            this.logger.info({
                message: "Stopping server...",
                context: this.logContext,
                id: LogId.httpServerStopping,
            });

            const server = this.httpServer;

            await new Promise((resolve, reject) => {
                server.close((err?: Error) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(undefined);
                    }
                });
            });
            this.logger.info({
                message: "Server stopped",
                context: this.logContext,
                id: LogId.httpServerStopped,
            });
        } else {
            this.logger.info({
                message: "Server is not running",
                context: this.logContext,
                id: LogId.httpServerStopped,
            });
        }
    }
}

type MCPHttpServerConfig<TUserConfig extends UserConfig, TContext> = {
    userConfig: TUserConfig;
    createServerForRequest: (createParams: {
        request: RequestContext;
        serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
        sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    }) => Promise<Server<TUserConfig, TContext>>;
    logger: LoggerBase;
    serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    sessionOptions?: CustomizableSessionOptions<TUserConfig>;
};

class MCPHttpServer<TUserConfig extends UserConfig = UserConfig, TContext = unknown> extends ExpressBasedHttpServer {
    protected sessionStore!: SessionStore<StreamableHTTPServerTransport>;

    private readonly serverOptions?: CustomizableServerOptions<TUserConfig, TContext>;
    private readonly sessionOptions?: CustomizableSessionOptions<TUserConfig>;
    protected readonly userConfig: UserConfig;

    protected isSSEUpgradeAllowed: boolean = true;

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
    }: MCPHttpServerConfig<TUserConfig, TContext>) {
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

    protected createTransportOptions(): WebStandardStreamableHTTPServerTransportOptions {
        return {
            enableJsonResponse: this.userConfig.httpResponseType === "json",
            onsessionclosed: async (sessionId): Promise<void> => {
                try {
                    await this.sessionStore.closeSession(sessionId, true);
                } catch (error) {
                    this.logger.error({
                        id: LogId.streamableHttpTransportSessionCloseFailure,
                        context: "streamableHttpTransport",
                        message: `Error closing session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
                    });
                }
            },
        };
    }

    public async stop(): Promise<void> {
        await Promise.all([this.sessionStore.closeAllSessions(), super.stop()]);
    }

    protected reportSessionError(res: express.Response, errorCode: number): void {
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
            case JSON_RPC_ERROR_CODE_TRANSPORT_MISSING:
                message = "transport is missing for session";
                statusCode = 500;
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

    protected override setupRoutes(): void {
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

        const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
            const sessionId = req.headers["mcp-session-id"];
            if (!sessionId) {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED);
            }

            if (typeof sessionId !== "string") {
                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_ID_INVALID);
            }

            if (!this.sessionStore.getSession(sessionId)) {
                if (this.userConfig.externallyManagedSessions) {
                    this.logger.debug({
                        id: LogId.streamableHttpTransportSessionNotFound,
                        context: "streamableHttpTransport",
                        message: `Session with ID ${sessionId} not found, initializing new session`,
                    });

                    return await initializeServer({
                        req,
                        res,
                        sessionInfo: { sessionId, isImplicitInitialization: true },
                    });
                }

                this.logger.debug({
                    id: LogId.streamableHttpTransportSessionNotFound,
                    context: "streamableHttpTransport",
                    message: `Session with ID ${sessionId} not found`,
                });

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND);
            }

            const transport = this.sessionStore.getSession(sessionId)?.value;
            if (!transport) {
                this.logger.debug({
                    id: LogId.streamableHttpTransportTransportMissing,
                    context: "streamableHttpTransport",
                    message: `Transport is missing for session with ID ${sessionId}`,
                });

                return this.reportSessionError(res, JSON_RPC_ERROR_CODE_TRANSPORT_MISSING);
            }

            await transport.handleRequest(req, res, req.body);
        };

        /**
         * Initializes a new server and session. This can be done either explicitly via an initialize request
         * or implicitly when externally managed sessions are enabled and a request is received for a session
         * that does not exist.
         */
        const initializeServer = async ({
            req,
            res,
            sessionInfo: { isImplicitInitialization, sessionId },
        }: {
            req: express.Request;
            res: express.Response;
            sessionInfo:
                | { sessionId?: string; isImplicitInitialization?: false }
                | { sessionId: string; isImplicitInitialization: true };
        }): Promise<void> => {
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

            const options = this.createTransportOptions();
            sessionId = sessionId ?? getRandomUUID();
            options.sessionIdGenerator = (): string => sessionId;

            const { StreamableHTTPServerTransport } =
                await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

            const transport = new StreamableHTTPServerTransport(options);
            // HACK: When we're implicitly initializing the session, we want to configure the session id and _inititized flag on the transport
            // so that it believes it actually went through the initialization flow.
            if (isImplicitInitialization) {
                const internalTransport = transport["_webStandardTransport"] as {
                    _initialized: boolean;
                    sessionId: string;
                };
                internalTransport._initialized = true;
                internalTransport.sessionId = sessionId;
            }

            server.session.logger.setAttribute("sessionId", sessionId);
            this.sessionStore.setSession(sessionId, transport, server.session.logger);

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

                    return await initializeServer({
                        req,
                        res,
                        sessionInfo: { sessionId, isImplicitInitialization: false },
                    });
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
                if (this.isSSEUpgradeAllowed) {
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

class HealthCheckServer extends ExpressBasedHttpServer {
    constructor(healthCheckHost: string, healthCheckPort: number, logger: LoggerBase) {
        super({
            port: healthCheckPort,
            hostname: healthCheckHost,
            logger,
            logContext: "healthCheckServer",
        });
    }

    protected override setupRoutes(): Promise<void> {
        this.app.get("/health", (_req: express.Request, res: express.Response) => {
            res.json({
                status: "ok",
            });
        });

        return Promise.resolve();
    }
}
