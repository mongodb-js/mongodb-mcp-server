import type { LoggerType, LogLevel, LogPayload } from "./loggingTypes.js";
import { LoggerBase } from "./loggerBase.js";
import type { ICompositeLogger, ILoggerBase } from "@mongodb-js/mcp-api";

export class CompositeLogger extends LoggerBase implements ICompositeLogger {
    protected readonly type?: LoggerType;

    private readonly loggers: ILoggerBase[] = [];
    private readonly attributes: Record<string, string> = {};

    constructor(...loggers: LoggerBase[]) {
        // composite logger does not redact, only the actual delegates do the work
        // so we don't need the Keychain here
        super(undefined);

        this.loggers = loggers;
    }

    public addLogger(logger: ILoggerBase): void {
        this.loggers.push(logger);
    }

    public log(level: LogLevel, payload: LogPayload): void {
        // Override the public method to avoid the base logger redacting the message payload
        for (const logger of this.loggers) {
            const attributes =
                Object.keys(this.attributes).length > 0 || payload.attributes
                    ? { ...this.attributes, ...payload.attributes }
                    : undefined;
            logger.log(level, { ...payload, attributes });
        }
    }

    protected logCore(): void {
        throw new Error("logCore should never be invoked on CompositeLogger");
    }

    public setAttribute(key: string, value: string): void {
        this.attributes[key] = value;
    }
}
