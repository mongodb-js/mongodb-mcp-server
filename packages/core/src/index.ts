export { LoggerBase } from "./logging/loggerBase.js";
export { NoopLogger } from "./logging/noopLogger.js";
export { CompositeLogger } from "./logging/compositeLogger.js";
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
