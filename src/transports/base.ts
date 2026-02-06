import type { UserConfig } from "../common/config/userConfig.js";
import { packageInfo } from "../common/packageInfo.js";
import { Server, type ServerOptions } from "../server.js";
import { Session } from "../common/session.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerBase } from "../common/logger.js";
import { CompositeLogger, ConsoleLogger, DiskLogger, McpLogger } from "../common/logger.js";
import { ExportsManager } from "../common/exportsManager.js";
import { DeviceId } from "../helpers/deviceId.js";
import { Keychain } from "../common/keychain.js";
import { createMCPConnectionManager } from "../common/connectionManager.js";
import { connectionErrorHandler as defaultConnectionErrorHandler } from "../common/connectionErrorHandler.js";
import type { CommonProperties } from "../telemetry/types.js";
import { Elicitation } from "../elicitation.js";
import { defaultCreateAtlasLocalClient } from "../common/atlasLocal.js";
import { VectorSearchEmbeddingsManager } from "../common/search/vectorSearchEmbeddingsManager.js";
import type { ToolClass } from "../tools/tool.js";
import { applyConfigOverrides } from "../common/config/configOverrides.js";
import type { ApiClient } from "../common/atlas/apiClient.js";
import { createAtlasApiClient } from "../common/atlas/apiClient.js";
import type { UIRegistry } from "../ui/registry/index.js";
import type { RequestContext, TransportRunnerConfig, LegacyTransportRunnerConfig } from "./runnerConfigs/index.js";

export abstract class TransportRunnerBase {
    public logger: LoggerBase;
    public deviceId: DeviceId;
    protected readonly userConfig: UserConfig;
    private readonly telemetryProperties: Partial<CommonProperties>;
    private readonly tools?: ToolClass[];

    protected constructor(private readonly runnerConfig: TransportRunnerConfig) {
        this.userConfig = runnerConfig.userConfig;
        this.tools = runnerConfig.tools;
        this.telemetryProperties = runnerConfig.telemetryProperties ?? {};
        const loggers: LoggerBase[] = [...(runnerConfig.additionalLoggers ?? [])];
        if (this.userConfig.loggers.includes("stderr")) {
            loggers.push(new ConsoleLogger(Keychain.root));
        }
        if (this.userConfig.loggers.includes("disk")) {
            loggers.push(
                new DiskLogger(
                    this.userConfig.logPath,
                    (err) => {
                        // If the disk logger fails to initialize, we log the error to stderr and exit
                        // eslint-disable-next-line no-console
                        console.error("Error initializing disk logger:", err);
                        process.exit(1);
                    },
                    Keychain.root
                )
            );
        }
        this.logger = new CompositeLogger(...loggers);
        this.deviceId = DeviceId.create(this.logger);
    }

    protected async setupServer(
        request?: RequestContext,
        {
            serverOptions,
        }: {
            serverOptions?: Pick<ServerOptions, "uiRegistry">;
        } = {}
    ): Promise<Server> {
        const { session, sessionConfig } = await this.createSessionFromLegacyConfig(this.runnerConfig, request);

        const mcpServer = new McpServer(
            {
                name: packageInfo.mcpServerName,
                version: packageInfo.version,
            },
            {
                instructions: TransportRunnerBase.getInstructions(sessionConfig),
            }
        );

        const telemetry = Telemetry.create(session, sessionConfig, this.deviceId, {
            commonProperties: this.telemetryProperties,
        });

        const elicitation = new Elicitation({ server: mcpServer.server });

        let uiRegistry: UIRegistry | undefined = serverOptions?.uiRegistry;
        if (!uiRegistry && sessionConfig.previewFeatures.includes("mcpUI")) {
            const uiRegistryModule = await import("../ui/registry/registry.js");
            uiRegistry = new uiRegistryModule.UIRegistry();
        }

        const server = new Server({
            mcpServer,
            session,
            telemetry,
            userConfig: sessionConfig,
            elicitation,
            tools: this.tools,
            uiRegistry,
        });

        // We need to create the MCP logger after the server is constructed
        // because it needs the server instance
        if (sessionConfig.loggers.includes("mcp")) {
            session.logger.addLogger(new McpLogger(server, Keychain.root));
        }

        return server;
    }

    private async createSessionFromLegacyConfig(
        {
            createConnectionManager = createMCPConnectionManager,
            connectionErrorHandler = defaultConnectionErrorHandler,
            createAtlasLocalClient = defaultCreateAtlasLocalClient,
            createApiClient = createAtlasApiClient,
            createSessionConfig,
        }: LegacyTransportRunnerConfig,
        requestContext?: RequestContext
    ): Promise<{ session: Session; sessionConfig: UserConfig }> {
        let userConfig: UserConfig = this.userConfig;
        if (createSessionConfig) {
            userConfig = await createSessionConfig({ userConfig: this.userConfig, request: requestContext });
        } else {
            userConfig = applyConfigOverrides({ baseConfig: this.userConfig, request: requestContext });
        }

        const logger = new CompositeLogger(this.logger);
        const exportsManager = ExportsManager.init(userConfig, logger);
        const connectionManager = await createConnectionManager({
            logger,
            userConfig,
            deviceId: this.deviceId,
        });

        let apiClient: ApiClient | undefined;
        if (userConfig.apiClientId && userConfig.apiClientSecret) {
            apiClient = createApiClient(
                {
                    baseUrl: userConfig.apiBaseUrl,
                    credentials: {
                        clientId: userConfig.apiClientId,
                        clientSecret: userConfig.apiClientSecret,
                    },
                    requestContext,
                },
                logger
            );
        }

        const atlasLocalClient = await createAtlasLocalClient({ logger });

        const session = new Session({
            userConfig,
            atlasLocalClient,
            logger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
            connectionErrorHandler,
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
            apiClient,
        });

        return {
            session,
            sessionConfig: userConfig,
        };
    }

    abstract start(): Promise<void>;

    abstract closeTransport(): Promise<void>;

    async close(): Promise<void> {
        try {
            await this.closeTransport();
        } finally {
            this.deviceId.close();
        }
    }

    private static getInstructions(config: UserConfig): string {
        let instructions = `
            This is the MongoDB MCP server.
        `;
        if (config.connectionString) {
            instructions += `
            This MCP server was configured with a MongoDB connection string, and you can assume that you are connected to a MongoDB cluster.
            `;
        }

        if (config.apiClientId && config.apiClientSecret) {
            instructions += `
            This MCP server was configured with MongoDB Atlas API credentials.`;
        }

        return instructions;
    }
}
