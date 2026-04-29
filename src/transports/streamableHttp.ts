import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { LoggerBase } from "@mongodb-js/mcp-core";
import { CompositeLogger, LogId } from "@mongodb-js/mcp-core";
import { type ISessionStore, type CreateSessionStoreFn, createDefaultSessionStore } from "../common/sessionStore.js";
import {
    TransportRunnerBase,
    type TransportRunnerConfig,
    type RequestContext,
    type CustomizableSessionOptions,
} from "./base.js";
import type { CustomizableServerOptions, Server, UserConfig } from "../lib.js";
import { applyConfigOverrides } from "../common/config/configOverrides.js";
import type { Metrics, DefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { MonitoringServerFeature } from "../common/schemas.js";
import {
    MCPHttpServer,
    type CreateMcpHttpServerFn,
    createDefaultMcpHttpServer,
    type MCPHttpServerConstructorArgs,
} from "./mcpHttpServer.js";
import { MonitoringServer, type CreateMonitoringServerFn, createDefaultMonitoringServer } from "./monitoringServer.js";

export { createDefaultMonitoringServer, MonitoringServer, createDefaultMcpHttpServer, MCPHttpServer };
export type { CreateMonitoringServerFn, MonitoringServerFeature, CreateMcpHttpServerFn, MCPHttpServerConstructorArgs };

/**
 * Configuration options for extracting monitoring server settings from UserConfig.
 */
export type MonitoringServerConfig = {
    monitoringServerHost?: string;
    monitoringServerPort?: number;
    healthCheckHost?: string;
    healthCheckPort?: number;
    monitoringServerFeatures: MonitoringServerFeature[];
};

/**
 * Configuration options for the StreamableHttpRunner.
 * Extends the base TransportRunnerConfig with HTTP-transport-specific options.
 *
 * @template TUserConfig - The type of user configuration
 * @template TMetrics - The type of metrics definitions
 */
export type StreamableHttpTransportRunnerConfig<
    TUserConfig extends UserConfig = UserConfig,
    TMetrics extends DefaultMetrics = DefaultMetrics,
    TContext = unknown,
> = TransportRunnerConfig<TUserConfig, TMetrics> & {
    /**
     * When provided, the runner will use this function to create the monitoring server
     * instead of using the default MonitoringServer constructor. This allows for
     * customizing the monitoring server (e.g., adding custom routes) while still
     * receiving the constructor arguments that would normally be used.
     */
    createMonitoringServer?: CreateMonitoringServerFn<TMetrics>;

    /**
     * When provided, the runner will use this function to create the session store
     * instead of using the default SessionStore constructor. This allows for
     * customizing session storage (e.g., Redis-backed storage, custom timeout behavior,
     * or shared session state across instances) while still receiving the constructor
     * arguments that would normally be used.
     */
    createSessionStore?: CreateSessionStoreFn<StreamableHTTPServerTransport, TMetrics>;

    /**
     * When provided, the runner will use this function to create the MCP HTTP server
     * instead of using the default MCPHttpServer constructor. This allows for
     * customizing the HTTP server (e.g., adding pre-route middleware) while still
     * receiving the constructor arguments that would normally be used.
     */
    createMcpHttpServer?: CreateMcpHttpServerFn<TUserConfig, TContext>;
};

export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "./jsonRpcErrorCodes.js";

export class StreamableHttpRunner<
    TUserConfig extends UserConfig = UserConfig,
    TContext = unknown,
    TMetrics extends DefaultMetrics = DefaultMetrics,
> extends TransportRunnerBase<TUserConfig, TContext, TMetrics> {
    private mcpServer: MCPHttpServer<TUserConfig, TContext> | undefined;
    private readonly monitoringServer: MonitoringServer<TMetrics> | undefined;
    private readonly sessionStore: ISessionStore<StreamableHTTPServerTransport>;
    private readonly createMcpHttpServer: CreateMcpHttpServerFn<TUserConfig, TContext>;

    constructor(config: StreamableHttpTransportRunnerConfig<TUserConfig, TMetrics, TContext>) {
        super(config);
        this.createMcpHttpServer = config.createMcpHttpServer ?? createDefaultMcpHttpServer;

        this.sessionStore = (config.createSessionStore ?? createDefaultSessionStore<StreamableHTTPServerTransport>)({
            options: {
                idleTimeoutMS: this.userConfig.idleTimeoutMs,
                notificationTimeoutMS: this.userConfig.notificationTimeoutMs,
            },
            logger: this.logger,
            metrics: this.metrics,
        });
        // Create monitoring server if host/port are configured
        const host = config.userConfig.monitoringServerHost ?? config.userConfig.healthCheckHost;
        const port = config.userConfig.monitoringServerPort ?? config.userConfig.healthCheckPort;
        if (host !== undefined && port !== undefined) {
            this.monitoringServer = (config.createMonitoringServer ?? createDefaultMonitoringServer)({
                host,
                port,
                features: config.userConfig.monitoringServerFeatures,
                logger: this.logger,
                metrics: this.metrics,
            });
        }
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

        this.mcpServer = this.createMcpHttpServer({
            userConfig: this.userConfig,
            createServerForRequest: ({ request }): Promise<Server<TUserConfig, TContext>> =>
                this.createServerForRequest({ request, serverOptions, sessionOptions }),
            logger: this.logger,
            metrics: this.metrics,
            sessionStore: this.sessionStore,
        });
        await this.mcpServer.start();

        // Start the monitoring server if one exists (either externally provided or created in constructor)
        await this.monitoringServer?.start();

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

/**
 * Constructor arguments for creating a MonitoringServer instance.
 */
export type MonitoringServerConstructorArgs<TMetrics extends DefaultMetrics = DefaultMetrics> = {
    host: string;
    port: number;
    features: MonitoringServerFeature[];
    logger: LoggerBase;
    metrics: Metrics<TMetrics>;
};
