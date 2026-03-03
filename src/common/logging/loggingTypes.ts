import type { MongoLogId } from "mongodb-log-writer";

import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

export type LogLevel = LoggingMessageNotification["params"]["level"];

export interface LogPayload {
    id: MongoLogId;
    context: string;
    message: string;
    noRedaction?: boolean | LoggerType | LoggerType[];
    attributes?: Record<string, string>;
}

export type LoggerType = "console" | "disk" | "mcp";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap<T> = Record<keyof T, any[]> | DefaultEventMap;
type DefaultEventMap = [never];
