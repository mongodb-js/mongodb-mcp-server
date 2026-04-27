import type { MongoLogId } from "mongodb-log-writer";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export type LoggerType = "console" | "disk" | "mcp";

export interface LogPayload {
    id: MongoLogId;
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap<T> = Record<keyof T, any[]>;

export type DefaultEventMap = Record<string, never[]>;

/**
 * The set of well-known MongoDB log identifiers used by the MCP server.
 *
 * Concrete `LogId` values are produced via `mongoLogId()` and live in
 * `@mongodb-js/mcp-core`. This type captures the shape exposed to consumers.
 */
export type LogIdMap = Readonly<Record<string, MongoLogId>>;

/**
 * Base interface that every logger implementation must satisfy.
 *
 * Concrete implementations (`CompositeLogger`, `ConsoleLogger`, `DiskLogger`,
 * `McpLogger`, `NullLogger`/`NoopLogger`) live in other packages.
 */
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

/**
 * A logger that fans out log records to a set of underlying loggers and
 * supports attaching additional loggers and shared attributes at runtime.
 */
export interface ICompositeLogger extends ILoggerBase {
    /** Adds another underlying logger to the composite. */
    addLogger(logger: ILoggerBase): void;

    /** Attaches a key/value attribute that will be added to every log record. */
    setAttribute(key: string, value: string): void;
}
