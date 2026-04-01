import type { MongoLogId } from "mongodb-log-writer";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * Log levels supported by the logger.
 */
export type LogLevel = LoggingMessageNotification["params"]["level"];

/**
 * Log ID type - accepts both MongoLogId objects and strings for convenience.
 */
export type LogId = MongoLogId | string;

/**
 * Log payload structure.
 */
export interface LogPayload {
    id: LogId;
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
}

/**
 * Logger type for redaction handling.
 */
export type LoggerType = "console" | "disk" | "mcp";

/**
 * Event map for logger event emitters.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventMap<T> = Record<keyof T, any[]>;

/**
 * Default event map (no events).
 */
export type DefaultEventMap = Record<string, never[]>;

/**
 * Base logger interface.
 * All logger implementations must satisfy this interface.
 */
export interface LoggerBase {
    debug(payload: LogPayload): void;
    info(payload: LogPayload): void;
    warning(payload: LogPayload): void;
    error(payload: LogPayload): void;
    emergency(payload: LogPayload): void;
    setAttribute(key: string, value: unknown): void;
}

// Re-export MongoLogId for convenience
export type { MongoLogId };
