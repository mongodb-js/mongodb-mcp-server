import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";
import type { IKeychain } from "./keychain.js";

export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export type LoggerType = "console" | "disk" | "mcp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap<T> = Record<keyof T, any[]>;

export type DefaultEventMap = Record<string, never[]>;

export type MongoDBLogLevel = "info" | "warn" | "error" | "debug" | "fatal";

export type LogWriteFunction = (
    component: string,
    id: MongoLogId,
    context: string,
    message: string,
    attr?: unknown
) => void;

export type LogWriter = Record<MongoDBLogLevel, LogWriteFunction> & {
    flush(): Promise<void>;
};

export type MongoLogId = {
    __value: number;
};

export type LogPayload<LogId = MongoLogId> = {
    id: LogId;
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
};

export interface ILogger {
    log(level: LogLevel, payload: LogPayload): void;
    info(payload: LogPayload): void;
    error(payload: LogPayload): void;
    debug(payload: LogPayload): void;
    notice(payload: LogPayload): void;
    warning(payload: LogPayload): void;
    critical(payload: LogPayload): void;
    alert(payload: LogPayload): void;
    emergency(payload: LogPayload): void;
    flush(): Promise<PromiseSettledResult<void>[]>;
}

export type LoggerConfig = {
    keychain: IKeychain;
};

export interface ICompositeLogger extends ILogger {
    addLogger(logger: ILogger): void;
    setAttribute(key: string, value: string): void;
}
