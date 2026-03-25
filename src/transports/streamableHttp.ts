import express from "express";
import type http from "http";
import type {
    StreamableHTTPServerTransport,
    StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
import { applyConfigOverrides } from "../common/config/configOverrides.js";
import type { DefaultMetrics, Metrics } from "../common/metrics/index.js";
import type { MonitoringServerFeature } from "../common/schemas.js";

const JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED = -32000;
const JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED = -32001;
const JSON_RPC_ERROR_CODE_SESSION_ID_INVALID = -32002;
const JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND = -32003;
const JSON_RPC_ERROR_CODE_INVALID_REQUEST = -32004;
const JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION = -32005;

export class StreamableHttpRunner<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TUserConfig, TContext, TMetrics> {
    private mcpServer: MCPHttpServer<TUserConfig, TContext> | undefined;
    private monitoringServer: MonitoringServer | undefined;

    constructor(config: TransportRunnerConfig<TUserConfig, TMetrics>) {
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

        this.mcpServer = new MCPHttpServer<TUserConfig, TContext>({
            userConfig: this.userConfig,
            createServerForRequest: ({ request }): Promise<Server<TUserConfig, TContext>> =>
                this.createServerForRequest({ request, serverOptions, sessionOptions }),
            logger: this.logger,
            metrics: this.metrics,
        });
        await this.mcpServer.start();

        this.monitoringServer = await MonitoringServer.create({
            host: this.userConfig.monitoringServerHost ?? this.userConfig.healthCheckHost,
            port: this.userConfig.monitoringServerPort ?? this.userConfig.healthCheckPort,
            features: this.userConfig.monitoringServerFeatures,
            logger: this.logger,
            metrics: this.metrics,
        });

        this.logger.info({
            message: "Streamable HTTP Transport started",
            context: "streamableHttpTransport",
            id: LogId.streamableHttpTransportStarted,
        });
    }

    async closeTransport(): Promise<void> {
        await Promise.all([this.mcpServer?.stop(), this.monitoringServer?.stop()]);
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

    private validateConfig(): void {
        if ((this.userConfig.healthCheckHost === undefined) !== (this.userConfig.healthCheckPort === undefined)) {
            throw new Error("Both healthCheckHost and healthCheckPort must be defined to enable health checks.");
        }

        if (
            (this.userConfig.monitoringServerHost === undefined) !==
            (this.userConfig.monitoringServerPort === undefined)
        ) {
            throw new Error(
                "Both monitoringServerHost and monitoringServerPort must be defined to enable the monitoring server."
            );
        }

        const effectivePort = this.userConfig.monitoringServerPort ?? this.userConfig.healthCheckPort;
        if (effectivePort !== undefined && effectivePort !== 0 && effectivePort === this.userConfig.httpPort) {
            throw new Error("Monitoring server port cannot be the same as httpPort.");
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

    protected abstract setupRoutes(): Promise<void>;

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

class MCPHttpServer<TUserConfig extends UserConfig = UserConfig, TContext = unknown> extends ExpressBasedHttpServer {
    private sessionStore!: SessionStore<StreamableHTTPServerTransport>;
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

        this.sessionStore = new SessionStore(
            this.userConfig.idleTimeoutMs,
            this.userConfig.notificationTimeoutMs,
            this.logger,
            this.metrics
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
            // HACK: When we're implicitly initializing the session, we want to configure the session id and _inititized flag on the transport
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
            this.sessionStore.setSession(sessionId, transport, server.session.logger);

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

class MonitoringServer extends ExpressBasedHttpServer {
    static async create({
        host,
        port,
        features,
        logger,
        metrics,
    }: {
        host: string | undefined;
        port: number | undefined;
        features: MonitoringServerFeature[];
        logger: LoggerBase;
        metrics: Metrics;
    }): Promise<MonitoringServer | undefined> {
        if (!host || port === undefined) {
            return undefined;
        }

        const server = new MonitoringServer({ host, port, features, logger, metrics });
        await server.start();
        return server;
    }

    private readonly features: MonitoringServerFeature[];
    private readonly metrics: Metrics;

    public get expressApp(): express.Express {
        return this.app;
    }

    private constructor({
        host,
        port,
        features,
        logger,
        metrics,
    }: {
        host: string;
        port: number;
        features: MonitoringServerFeature[];
        logger: LoggerBase;
        metrics: Metrics;
    }) {
        super({ port, hostname: host, logger, logContext: "monitoringServer" });
        this.features = features;
        this.metrics = metrics;
    }

    protected override setupRoutes(): Promise<void> {
        if (this.features.includes("health-check")) {
            this.app.get("/health", (_req: express.Request, res: express.Response) => {
                res.json({ status: "ok" });
            });
        }

        if (this.features.includes("metrics") && this.metrics?.getMetrics) {
            const getMetrics = this.metrics.getMetrics.bind(this.metrics);
            this.app.get("/metrics", async (_req: express.Request, res: express.Response) => {
                try {
                    const output = await getMetrics();
                    res.set("Content-Type", "text/plain");
                    res.send(output);
                } catch (err) {
                    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
                }
            });
        }

        return Promise.resolve();
    }
}
