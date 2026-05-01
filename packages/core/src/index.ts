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

export {
    ToolBase,
    type ToolClass,
    type ToolConstructorParams,
    type AnyToolBase,
    type ToolArgs,
    type ToolExecutionContext,
    type ToolResult,
    type OperationType,
    type ToolCategory,
    formatUntrustedData,
} from "./toolBase.js";
export type { DefaultMetrics } from "@mongodb-js/mcp-metrics";
export { getRandomUUID } from "./randomUUID.js";
export { TRANSPORT_PAYLOAD_LIMITS } from "./transportConstants.js";
export { CommonArgs, NO_UNICODE_ERROR } from "./args.js";

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
