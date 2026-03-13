import { CompositeLogger, LogId } from "../../common/logging/index.js";
import {
    TransportRunnerBase,
    type TransportRunnerConfig,
    type RequestContext,
    type CustomizableSessionOptions,
} from "../base.js";
import type { CustomizableServerOptions, Server, UserConfig } from "../../lib.js";
import { applyConfigOverrides } from "../../common/config/configOverrides.js";
import { HealthCheckServer } from "./httpServers/healthCheckServer.js";
import { MCPHttpServer } from "./httpServers/mcpHttpServer.js";

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
        this.mcpServer = new MCPHttpServer<TUserConfig, TContext>({
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
        });
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
