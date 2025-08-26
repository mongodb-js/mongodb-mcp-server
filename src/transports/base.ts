import type { DriverOptions, UserConfig } from "../common/config.js";
import { packageInfo } from "../common/packageInfo.js";
import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggerBase } from "../common/logger.js";
import { CompositeLogger, ConsoleLogger, DiskLogger, McpLogger } from "../common/logger.js";
import { ExportsManager } from "../common/exportsManager.js";
import { ConnectionManager } from "../common/connectionManager.js";
import { DeviceId } from "../helpers/deviceId.js";

export abstract class TransportRunnerBase {
    public logger: LoggerBase;
    public deviceId: DeviceId;

    protected constructor(
        protected readonly userConfig: UserConfig,
        private readonly driverOptions: DriverOptions,
        additionalLoggers: LoggerBase[]
    ) {
        const loggers: LoggerBase[] = [...additionalLoggers];
        if (this.userConfig.loggers.includes("stderr")) {
            loggers.push(new ConsoleLogger());
        }

        if (this.userConfig.loggers.includes("disk")) {
            loggers.push(
                new DiskLogger(this.userConfig.logPath, (err) => {
                    // If the disk logger fails to initialize, we log the error to stderr and exit
                    console.error("Error initializing disk logger:", err);
                    process.exit(1);
                })
            );
        }

        this.logger = new CompositeLogger(...loggers);
        this.deviceId = DeviceId.create(this.logger);
    }

    protected setupServer(): Server {
        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        const loggers = [this.logger];
        if (this.userConfig.loggers.includes("mcp")) {
            loggers.push(new McpLogger(mcpServer));
        }

        const logger = new CompositeLogger(...loggers);
        const exportsManager = ExportsManager.init(this.userConfig, logger);
        const connectionManager = new ConnectionManager(this.userConfig, this.driverOptions, logger, this.deviceId);

        const session = new Session({
            apiBaseUrl: this.userConfig.apiBaseUrl,
            apiClientId: this.userConfig.apiClientId,
            apiClientSecret: this.userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
        });

        const telemetry = Telemetry.create(session, this.userConfig, this.deviceId);

        return new Server({
            mcpServer,
            session,
            telemetry,
            userConfig: this.userConfig,
        });
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
