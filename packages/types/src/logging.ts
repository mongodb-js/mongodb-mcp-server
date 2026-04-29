import type { MongoLogId } from "mongodb-log-writer";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type { MongoLogId } from "mongodb-log-writer";
export type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export type LoggerType = "console" | "disk" | "mcp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap<T> = Record<keyof T, any[]>;

export type DefaultEventMap = Record<string, never[]>;

export type LogPayload = {
    id: MongoLogId;
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
}

export interface ICompositeLogger extends ILogger {
    addLogger(logger: ILogger): void;
    setAttribute(options: { key: string; value: string }): void;
}

export type IMcpConnection = Pick<McpServer, "isConnected" | "sendLoggingMessage"> & {
    readonly mcpLogLevel: LogLevel;
};
