// Re-export web-friendly transports from core
export {
    InMemoryTransport,
    SessionStore,
    TransportRunnerBase,
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "@mongodb-js/mcp-core";

export type {
    ServerOptions,
    TransportRunnerBaseOptions,
    CustomizableServerOptions,
    CustomizableSessionOptions,
    MetricDefinitions,
    DefaultMetricDefinitions,
    ISessionStore,
    SessionStoreConstructorArgs,
} from "@mongodb-js/mcp-core";

// Types from mcp-types
export type {
    HttpServerConfig,
    MonitoringServerConfig,
    SessionManagementConfig,
    MonitoringServerFeature,
    CloseableTransport,
    SessionCloseReason,
    TransportRequestContext,
} from "@mongodb-js/mcp-types";

// Node.js-specific exports
export type { StdioRunnerOptions, DryRunModeRunnerOptions, ServerFactory, StdioServer, DryRunServer } from "./types.js";

export type { StreamableHttpRunnerOptions } from "./streamableHttp.js";

// Node.js-specific transport runners
export { StdioRunner } from "./stdio.js";
export { StreamableHttpRunner } from "./streamableHttp.js";

// HTTP Servers
export { MCPHttpServer, type MCPHttpServerOptions } from "./mcpHttpServer.js";
export {
    MonitoringServer,
    type MonitoringServerOptions,
    type MonitoringServerDependencies,
} from "./monitoringServer.js";

// Express HTTP Server base
export { ExpressBasedHttpServer, type ExpressConfig } from "./expressBasedHttpServer.js";
