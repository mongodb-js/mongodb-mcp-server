import type { LoggerType, LogLevel, LogPayload } from "@mongodb-js/mcp-types";
import { LoggerBase } from "./loggerBase.js";

export class CompositeLogger extends LoggerBase {
    protected readonly type?: LoggerType;

    private readonly loggers: LoggerBase[] = [];
    private readonly attributes: Record<string, string> = {};

    constructor(...loggers: LoggerBase[]) {
        super();
        this.loggers = loggers;
    }

    public addLogger(logger: LoggerBase): void {
        this.loggers.push(logger);
    }

    public log(level: LogLevel, payload: LogPayload): void {
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
