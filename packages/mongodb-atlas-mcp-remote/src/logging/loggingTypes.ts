import type { MongoLogId } from "mongodb-log-writer";

export type LogLevel = "debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency";

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
