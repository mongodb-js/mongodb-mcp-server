import type { UserConfig } from "../common/config/userConfig.js";
import { packageInfo } from "../common/packageInfo.js";
import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerBase } from "../common/logger.js";
import { CompositeLogger, ConsoleLogger, DiskLogger, McpLogger } from "../common/logger.js";
import { ExportsManager } from "../common/exportsManager.js";
import { DeviceId } from "../helpers/deviceId.js";
import { Keychain } from "../common/keychain.js";
import { createMCPConnectionManager, type ConnectionManagerFactoryFn } from "../common/connectionManager.js";
import {
    type ConnectionErrorHandler,
    connectionErrorHandler as defaultConnectionErrorHandler,
} from "../common/connectionErrorHandler.js";
import type { CommonProperties } from "../telemetry/types.js";
import { Elicitation } from "../elicitation.js";
import type { AtlasLocalClientFactoryFn } from "../common/atlasLocal.js";
import { defaultCreateAtlasLocalClient } from "../common/atlasLocal.js";
import type { Client } from "@mongodb-js/atlas-local";
import { VectorSearchEmbeddingsManager } from "../common/search/vectorSearchEmbeddingsManager.js";
import type { ToolBase, ToolConstructorParams } from "../tools/tool.js";
import { applyConfigOverrides } from "../common/config/configOverrides.js";

export type RequestContext = {
    headers?: Record<string, string | string[] | undefined>;
    query?: Record<string, string | string[] | undefined>;
};

type CreateSessionConfigFn = (context: {
    userConfig: UserConfig;
    request?: RequestContext;
}) => Promise<UserConfig> | UserConfig;

export type TransportRunnerConfig = {
    userConfig: UserConfig;
    createConnectionManager?: ConnectionManagerFactoryFn;
    connectionErrorHandler?: ConnectionErrorHandler;
    createAtlasLocalClient?: AtlasLocalClientFactoryFn;
    additionalLoggers?: LoggerBase[];
    telemetryProperties?: Partial<CommonProperties>;
    tools?: (new (params: ToolConstructorParams) => ToolBase)[];
    /**
     * Hook which allows library consumers to fetch configuration from external sources (e.g., secrets managers, APIs)
     * or modify the existing configuration before the session is created.
     */
    createSessionConfig?: CreateSessionConfigFn;
};

export abstract class TransportRunnerBase {
    public logger: LoggerBase;
    public deviceId: DeviceId;
    protected readonly userConfig: UserConfig;
    private readonly createConnectionManager: ConnectionManagerFactoryFn;
    private readonly connectionErrorHandler: ConnectionErrorHandler;
    private readonly atlasLocalClient: Promise<Client | undefined>;
    private readonly telemetryProperties: Partial<CommonProperties>;
    private readonly tools?: (new (params: ToolConstructorParams) => ToolBase)[];
    private readonly createSessionConfig?: CreateSessionConfigFn;

    protected constructor({
        userConfig,
        createConnectionManager = createMCPConnectionManager,
        connectionErrorHandler = defaultConnectionErrorHandler,
        createAtlasLocalClient = defaultCreateAtlasLocalClient,
        additionalLoggers = [],
        telemetryProperties = {},
        tools,
        createSessionConfig,
    }: TransportRunnerConfig) {
        this.userConfig = userConfig;
        this.createConnectionManager = createConnectionManager;
        this.connectionErrorHandler = connectionErrorHandler;
        this.atlasLocalClient = createAtlasLocalClient();
        this.telemetryProperties = telemetryProperties;
        this.tools = tools;
        this.createSessionConfig = createSessionConfig;
        const loggers: LoggerBase[] = [...additionalLoggers];
        if (this.userConfig.loggers.includes("stderr")) {
            loggers.push(new ConsoleLogger(Keychain.root));
        }

        if (this.userConfig.loggers.includes("disk")) {
            loggers.push(
                new DiskLogger(
                    this.userConfig.logPath,
                    (err) => {
                        // If the disk logger fails to initialize, we log the error to stderr and exit
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

    protected async setupServer(request?: RequestContext): Promise<Server> {
        // Apply config overrides from request context (headers and query parameters)
        let userConfig = applyConfigOverrides({ baseConfig: this.userConfig, request });

        // Call the config provider hook if provided, allowing consumers to
        // fetch or modify configuration after applying request context overrides
        if (this.createSessionConfig) {
            userConfig = await this.createSessionConfig({ userConfig, request });
        }

        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        const logger = new CompositeLogger(this.logger);
        const exportsManager = ExportsManager.init(userConfig, logger);
        const connectionManager = await this.createConnectionManager({
            logger,
            userConfig,
            deviceId: this.deviceId,
        });

        const session = new Session({
            userConfig,
            atlasLocalClient: await this.atlasLocalClient,
            logger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
            vectorSearchEmbeddingsManager: new VectorSearchEmbeddingsManager(userConfig, connectionManager),
        });

        const telemetry = Telemetry.create(session, userConfig, this.deviceId, {
            commonProperties: this.telemetryProperties,
        });

        const elicitation = new Elicitation({ server: mcpServer.server });

        const result = new Server({
            mcpServer,
            session,
            telemetry,
            userConfig,
            connectionErrorHandler: this.connectionErrorHandler,
            elicitation,
            tools: this.tools,
        });

        // We need to create the MCP logger after the server is constructed
        // because it needs the server instance
        if (userConfig.loggers.includes("mcp")) {
            logger.addLogger(new McpLogger(result, Keychain.root));
        }

        return result;
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
}
