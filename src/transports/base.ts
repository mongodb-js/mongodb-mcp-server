import type { UserConfig } from "../common/config.js";
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

export type TransportRunnerConfig = {
    userConfig: UserConfig;
    createConnectionManager?: ConnectionManagerFactoryFn;
    connectionErrorHandler?: ConnectionErrorHandler;
    additionalLoggers?: LoggerBase[];
};

export abstract class TransportRunnerBase {
    public logger: LoggerBase;
    public deviceId: DeviceId;
    protected readonly userConfig: UserConfig;
    private readonly createConnectionManager: ConnectionManagerFactoryFn;
    private readonly connectionErrorHandler: ConnectionErrorHandler;

    protected constructor({
        userConfig,
        createConnectionManager = createMCPConnectionManager,
        connectionErrorHandler = defaultConnectionErrorHandler,
        additionalLoggers = [],
    }: TransportRunnerConfig) {
        this.userConfig = userConfig;
        this.createConnectionManager = createConnectionManager;
        this.connectionErrorHandler = connectionErrorHandler;
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

    protected async setupServer(): Promise<Server> {
        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        const logger = new CompositeLogger(this.logger);
        const exportsManager = ExportsManager.init(this.userConfig, logger);
        const connectionManager = await this.createConnectionManager({
            logger,
            userConfig: this.userConfig,
            deviceId: this.deviceId,
        });

        const session = new Session({
            apiBaseUrl: this.userConfig.apiBaseUrl,
            apiClientId: this.userConfig.apiClientId,
            apiClientSecret: this.userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
            keychain: Keychain.root,
        });

        const telemetry = Telemetry.create(session, this.userConfig, this.deviceId);

        const result = new Server({
            mcpServer,
            session,
            telemetry,
            userConfig: this.userConfig,
            connectionErrorHandler: this.connectionErrorHandler,
        });

        // We need to create the MCP logger after the server is constructed
        // because it needs the server instance
        if (this.userConfig.loggers.includes("mcp")) {
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
