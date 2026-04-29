export { LoggerBase } from "./logging/loggerBase.js";
export { McpLogger } from "./logging/mcpLogger.js";
export { ConsoleLogger } from "./logging/consoleLogger.js";
export { NoopLogger } from "./logging/noopLogger.js";
export { CompositeLogger } from "./logging/compositeLogger.js";
export { LogId } from "./logging/logId.js";
export { Keychain, registerGlobalSecretToRedact } from "./keychain.js";
export type {
    LogLevel,
    LogPayload,
    LoggerType,
    EventMap,
    DefaultEventMap,
    ILogger,
    ICompositeLogger,
    IKeychain,
    MongoLogId,
} from "@mongodb-js/mcp-types";
export type { Secret } from "mongodb-redact";
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { LogLevel } from "@mongodb-js/mcp-types";

export const MCP_LOG_LEVELS: readonly LogLevel[] = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
];
