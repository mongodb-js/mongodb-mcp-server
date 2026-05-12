// Web-specific entry point for @mongodb-js/mcp-transports
// Exports only browser-compatible modules that don't depend on Node.js-specific APIs

export type {
    ServerOptions,
    TransportRunnerBaseOptions,
    StdioRunnerOptions,
    DryRunModeRunnerOptions,
    CustomizableServerOptions,
    CustomizableSessionOptions,
    MetricDefinitions,
    DefaultMetricDefinitions,
    ServerFactory,
    StdioServer,
    DryRunServer,
} from "./types.js";

export type {
    HttpServerConfig,
    MonitoringServerConfig,
    SessionManagementConfig,
    MonitoringServerFeature,
    ISessionStore,
    SessionStoreConstructorArgs,
    CloseableTransport,
    SessionCloseReason,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";

export { TransportRunnerBase } from "./base.js";
export { InMemoryTransport } from "./inMemoryTransport.js";
export { SessionStore } from "./sessionStore.js";

export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "./jsonRpcErrorCodes.js";
