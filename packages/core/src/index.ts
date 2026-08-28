export { LoggerBase } from "./logging/loggerBase.js";
export { NoopLogger } from "./logging/noopLogger.js";
export { CompositeLogger } from "./logging/compositeLogger.js";
export { Keychain, registerGlobalSecretToRedact, redactValues } from "./keychain.js";
export { NoopTelemetry } from "./telemetry/noopTelemetry.js";
export { UserFacingError } from "./errors.js";
export type { Secret } from "mongodb-redact";
export { McpServer } from "@modelcontextprotocol/server";
export type { InputRequiredResult, CallToolResult } from "@modelcontextprotocol/server";

import type { LogLevel } from "@mongodb-js/mcp-types";

export {
    ToolBase,
    toToolExecutionContext,
    type ToolClass,
    type AnyToolClass,
    type ToolConstructorParams,
    type AnyToolBase,
    type ToolArgs,
    type ToolResult,
    type ToolOutput,
    formatUntrustedData,
} from "./toolBase.js";
export { ReactiveResource } from "./reactiveResource.js";
export { getRandomUUID } from "./getRandomUUID.js";
export { TRANSPORT_PAYLOAD_LIMITS } from "./transportConstants.js";
export { CommonArgs, ASCII_ONLY_NON_CC_ERROR } from "./args.js";
export { LogId } from "./logId.js";
export { setManagedTimeout, type ManagedTimeout, sleep } from "./managedTimeout.js";
export { requestIdAttr } from "./helpers/requestIdAttr.js";

// Web-friendly transports
export { InMemoryTransport } from "./inMemoryTransport.js";
export { StdioRunner } from "./runners/stdioRunner.js";

export { NoopMetrics } from "./metrics/noopMetrics.js";
export { Elicitation, CONFIRMATION_INPUT_KEY } from "./elicitation.js";
// ElicitedInputResult / ElicitRequestSchema / IElicitation / ElicitationInputResponses live in @mongodb-js/mcp-types.
export type {
    ElicitedInputResult,
    ElicitRequestSchema,
    IElicitation,
    ElicitationInputResponses,
} from "@mongodb-js/mcp-types";

export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
} from "./jsonRpcErrorCodes.js";
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
