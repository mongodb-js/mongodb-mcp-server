import fs from "fs/promises";
import { mongoLogId, MongoLogId, MongoLogManager, MongoLogWriter } from "mongodb-log-writer";
import redact from "mongodb-redact";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export const LogId = {
    serverStartFailure: mongoLogId(1_000_001),
    serverInitialized: mongoLogId(1_000_002),
    serverCloseRequested: mongoLogId(1_000_003),
    serverClosed: mongoLogId(1_000_004),
    serverCloseFailure: mongoLogId(1_000_005),

    atlasCheckCredentials: mongoLogId(1_001_001),
    atlasDeleteDatabaseUserFailure: mongoLogId(1_001_002),
    atlasConnectFailure: mongoLogId(1_001_003),
    atlasInspectFailure: mongoLogId(1_001_004),

    telemetryDisabled: mongoLogId(1_002_001),
    telemetryEmitFailure: mongoLogId(1_002_002),
    telemetryEmitStart: mongoLogId(1_002_003),
    telemetryEmitSuccess: mongoLogId(1_002_004),
    telemetryMetadataError: mongoLogId(1_002_005),
    telemetryDeviceIdFailure: mongoLogId(1_002_006),
    telemetryDeviceIdTimeout: mongoLogId(1_002_007),

    toolExecute: mongoLogId(1_003_001),
    toolExecuteFailure: mongoLogId(1_003_002),
    toolDisabled: mongoLogId(1_003_003),

    mongodbConnectFailure: mongoLogId(1_004_001),
    mongodbDisconnectFailure: mongoLogId(1_004_002),
} as const;

abstract class LoggerBase {
    abstract log(level: LogLevel, id: MongoLogId, context: string, message: string): void;

    info(id: MongoLogId, context: string, message: string): void {
        this.log("info", id, context, message);
    }

    error(id: MongoLogId, context: string, message: string): void {
        this.log("error", id, context, message);
    }
    debug(id: MongoLogId, context: string, message: string): void {
        this.log("debug", id, context, message);
    }

    notice(id: MongoLogId, context: string, message: string): void {
        this.log("notice", id, context, message);
    }

    warning(id: MongoLogId, context: string, message: string): void {
        this.log("warning", id, context, message);
    }

    critical(id: MongoLogId, context: string, message: string): void {
        this.log("critical", id, context, message);
    }

    alert(id: MongoLogId, context: string, message: string): void {
        this.log("alert", id, context, message);
    }

    emergency(id: MongoLogId, context: string, message: string): void {
        this.log("emergency", id, context, message);
    }
}

class ConsoleLogger extends LoggerBase {
    log(level: LogLevel, id: MongoLogId, context: string, message: string): void {
        message = redact(message);
        console.error(`[${level.toUpperCase()}] ${id.__value} - ${context}: ${message}`);
    }
}

class DiskLogger extends LoggerBase {
    private constructor(private logWriter: MongoLogWriter) {
        super();
    }

    static async fromPath(logPath: string): Promise<DiskLogger> {
        await fs.mkdir(logPath, { recursive: true });

        const manager = new MongoLogManager({
            directory: logPath,
            retentionDays: 30,
            onwarn: console.warn,
            onerror: console.error,
            gzip: false,
            retentionGB: 1,
        });

        await manager.cleanupOldLogFiles();

        const logWriter = await manager.createLogWriter();

        return new DiskLogger(logWriter);
    }

    log(level: LogLevel, id: MongoLogId, context: string, message: string): void {
        message = redact(message);
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel]("MONGODB-MCP", id, context, message);
    }

    private mapToMongoDBLogLevel(level: LogLevel): "info" | "warn" | "error" | "debug" | "fatal" {
        switch (level) {
            case "info":
                return "info";
            case "warning":
                return "warn";
            case "error":
                return "error";
            case "notice":
            case "debug":
                return "debug";
            case "critical":
            case "alert":
            case "emergency":
                return "fatal";
            default:
                return "info";
        }
    }
}

class McpLogger extends LoggerBase {
    constructor(private server: McpServer) {
        super();
    }

    log(level: LogLevel, _: MongoLogId, context: string, message: string): void {
        // Only log if the server is connected
        if (!this.server?.isConnected()) {
            return;
        }

        void this.server.server.sendLoggingMessage({
            level,
            data: `[${context}]: ${message}`,
        });
    }
}

class CompositeLogger extends LoggerBase {
    private loggers: LoggerBase[];

    constructor(...loggers: LoggerBase[]) {
        super();

        if (loggers.length === 0) {
            // default to ConsoleLogger
            this.loggers = [new ConsoleLogger()];
            return;
        }

        this.loggers = [...loggers];
    }

    setLoggers(...loggers: LoggerBase[]): void {
        if (loggers.length === 0) {
            throw new Error("At least one logger must be provided");
        }
        this.loggers = [...loggers];
    }

    log(level: LogLevel, id: MongoLogId, context: string, message: string): void {
        for (const logger of this.loggers) {
            logger.log(level, id, context, message);
        }
    }
}

const logger = new CompositeLogger();
export default logger;

export async function initializeLogger(server: McpServer, logPath: string): Promise<LoggerBase> {
    const diskLogger = await DiskLogger.fromPath(logPath);
    const mcpLogger = new McpLogger(server);

    logger.setLoggers(mcpLogger, diskLogger);

    return logger;
}
