import type { MongoLogId } from "mongodb-log-writer";

export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

export type LoggerType = "console" | "disk" | "mcp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap<T> = Record<keyof T, any[]>;

export type DefaultEventMap = Record<string, never[]>;

export interface LogPayload {
    id: MongoLogId;
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
}

export interface ILoggerBase {
    log(level: LogLevel, payload: LogPayload): void;
    info(payload: LogPayload): void;
    error(payload: LogPayload): void;
    debug(payload: LogPayload): void;
    notice(payload: LogPayload): void;
    warning(payload: LogPayload): void;
    critical(payload: LogPayload): void;
    alert(payload: LogPayload): void;
    emergency(payload: LogPayload): void;
}

export interface ICompositeLogger extends ILoggerBase {
    addLogger(logger: ILoggerBase): void;
    setAttribute(key: string, value: string): void;
}
