export { LoggerBase } from "./logging/loggerBase.js";
export { NoopLogger } from "./logging/noopLogger.js";
export { CompositeLogger } from "./logging/compositeLogger.js";
export { Keychain, registerGlobalSecretToRedact } from "./keychain.js";
export { NoopTelemetry } from "./telemetry/noopTelemetry.js";
export { UserFacingError } from "./errors.js";
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
    type AnyToolClass,
    type ToolConstructorParams,
    type AnyToolBase,
    type ToolArgs,
    type ToolResult,
    formatUntrustedData,
} from "./toolBase.js";
export type { ToolExecutionContext, OperationType, ToolCategory, CallToolResult } from "@mongodb-js/mcp-types";
export { ReactiveResource } from "./reactiveResource.js";
export type { ResourceClass } from "@mongodb-js/mcp-types";
export { getRandomUUID } from "./randomUUID.js";
export { TRANSPORT_PAYLOAD_LIMITS } from "./transportConstants.js";
export { CommonArgs, NO_UNICODE_ERROR } from "./args.js";
export { LogId } from "./logId.js";
export { setManagedTimeout, type ManagedTimeout } from "./managedTimeout.js";

// Web-friendly transports
export { InMemoryTransport } from "./inMemoryTransport.js";
export { SessionStore, type ISessionStore, type SessionStoreConstructorArgs } from "./sessionStore.js";
export { StdioRunner } from "./runners/stdioRunner.js";

export { NoopMetrics } from "./metrics/noopMetrics.js";
export { Elicitation, type ElicitedInputResult } from "./elicitation.js";

export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "./jsonRpcErrorCodes.js";
export type { ServerOptions } from "./transports.js";

export type { TransportRequestContext, CloseableTransport } from "@mongodb-js/mcp-types";

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
