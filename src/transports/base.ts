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
import { createAtlasApiClient } from "../common/atlas/apiClient.js";
import type { UIRegistry } from "../ui/registry/index.js";
import type { RequestContext, TransportRunnerConfig, LegacyTransportRunnerConfig } from "./runnerConfigs/index.js";

export abstract class TransportRunnerBase {
    /**
     * A CompositeLogger instance built using the sub-logger configuration
     * defined in `TransportRunnerConfig.userConfig` and
     * `TransportRunnerConfig.additionalLoggers`.
     *
     * Note: This does not include the MCP logger because an MCP logger is
     * initialized only for an MCP session. Additionally, session specific
     * logger might include more sub-loggers.
     */
    public baseLogger: CompositeLogger;
    protected deviceId: DeviceId;

    /**
     * The base `UserConfig` used to define non-session specific components.
     * This `UserConfig` object is used further to derive session specific
     * `UserConfig`.
     */
    protected readonly baseUserConfig: UserConfig;
    private readonly telemetryProperties: Partial<CommonProperties>;
    private readonly tools?: ToolClass[];

    protected constructor(private readonly runnerConfig: TransportRunnerConfig) {
        this.baseUserConfig = runnerConfig.userConfig;
        this.tools = runnerConfig.tools;
        this.telemetryProperties = runnerConfig.telemetryProperties ?? {};
        const loggers: LoggerBase[] = [...(runnerConfig.additionalLoggers ?? [])];
        if (this.baseUserConfig.loggers.includes("stderr")) {
            loggers.push(new ConsoleLogger(Keychain.root));
        }
        if (this.baseUserConfig.loggers.includes("disk")) {
            loggers.push(
                new DiskLogger(
                    this.baseUserConfig.logPath,
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
        this.baseLogger = new CompositeLogger(...loggers);
        this.deviceId = DeviceId.create(this.baseLogger);
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
        const sessionConfig: UserConfig =
            (await createSessionConfig?.({
                userConfig: this.baseUserConfig,
                request: requestContext,
            })) ?? applyConfigOverrides({ baseConfig: this.baseUserConfig, request: requestContext });

        const sessionLogger = new CompositeLogger(this.baseLogger);
        const exportsManager = ExportsManager.init(sessionConfig, sessionLogger);
        const connectionManager = await createConnectionManager({
            logger: sessionLogger,
            userConfig: sessionConfig,
            deviceId: this.deviceId,
        });

        const apiClient = createApiClient(
            {
                baseUrl: sessionConfig.apiBaseUrl,
                credentials: {
                    clientId: sessionConfig.apiClientId,
                    clientSecret: sessionConfig.apiClientSecret,
                },
                requestContext,
            },
            sessionLogger
        );

        const atlasLocalClient = await createAtlasLocalClient({ logger: sessionLogger });

        const session = new Session({
            userConfig: sessionConfig,
            atlasLocalClient,
            logger: sessionLogger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
            connectionErrorHandler,
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(sessionConfig, connectionManager),
            apiClient,
        });

        return {
            session,
            sessionConfig,
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
