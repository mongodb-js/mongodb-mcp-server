import { LoggerBase } from "@mongodb-js/mcp-core";
import type { LogLevel, LogPayload, LoggerType, LogWriter, LoggerConfig } from "@mongodb-js/mcp-types";

export type DiskLoggerOptions = {
    logWriter: LogWriter;
} & LoggerConfig;

export class DiskLogger extends LoggerBase {
    private readonly logWriter: LogWriter;

    public constructor(options: DiskLoggerOptions) {
        const { logWriter, ...loggerOptions } = options;
        super(loggerOptions);
        this.logWriter = logWriter;
    }

    protected readonly type: LoggerType = "disk";

    protected logCore(level: LogLevel, payload: LogPayload): void {
        const { id, context, message } = payload;
        const mongoDBLevel = this.mapToMongoDBLogLevel(level);

        this.logWriter[mongoDBLevel]("MONGODB-MCP", id, context, message, payload.attributes);
    }

    public override async flush(): Promise<PromiseSettledResult<void>[]> {
        return Promise.allSettled([this.logWriter.flush()]);
    }

    protected mapToMongoDBLogLevel(level: LogLevel): "info" | "warn" | "error" | "debug" | "fatal" {
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
