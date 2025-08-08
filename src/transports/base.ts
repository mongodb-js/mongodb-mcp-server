import { UserConfig } from "../common/config.js";
import { packageInfo } from "../common/packageInfo.js";
import { Server } from "../server.js";
import { Session } from "../common/session.js";
import { Telemetry } from "../telemetry/telemetry.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CompositeLogger, ConsoleLogger, DiskLogger, LoggerBase, McpLogger } from "../common/logger.js";
import { ExportsManager } from "../common/exportsManager.js";
import { ConnectionManager } from "../common/connectionManager.js";

export abstract class TransportRunnerBase {
    public logger: LoggerBase;

    protected constructor(protected readonly userConfig: UserConfig) {
        const loggers: LoggerBase[] = [];
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
    }

    protected setupServer(userConfig: UserConfig): Server {
        const mcpServer = new McpServer({
            name: packageInfo.mcpServerName,
            version: packageInfo.version,
        });

        const loggers = [this.logger];
        if (userConfig.loggers.includes("mcp")) {
            loggers.push(new McpLogger(mcpServer));
        }

        const logger = new CompositeLogger(...loggers);
        const exportsManager = ExportsManager.init(userConfig, logger);
        const connectionManager = new ConnectionManager();

        const session = new Session({
            apiBaseUrl: userConfig.apiBaseUrl,
            apiClientId: userConfig.apiClientId,
            apiClientSecret: userConfig.apiClientSecret,
            logger,
            exportsManager,
            connectionManager,
        });

        const telemetry = Telemetry.create(session, userConfig);

        return new Server({
            mcpServer,
            session,
            telemetry,
            userConfig,
        });
    }

    abstract start(): Promise<void>;

    abstract close(): Promise<void>;
}
