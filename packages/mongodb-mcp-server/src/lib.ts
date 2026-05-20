/** This file is temporarily used for generating API reports against the v1 API for comparison purposes. */
export { Server, type ServerOptions } from "@mongodb-js/mcp-cli";
export { Session } from "@mongodb-js/mcp-cli";
export type { SessionEvents } from "@mongodb-js/mcp-types";
export { type UserConfig, UserConfigSchema, configRegistry } from "@mongodb-js/mcp-cli";
export { parseUserConfig, defaultParserOptions, type ParserOptions } from "@mongodb-js/mcp-cli";

export { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";
export { AllTools } from "./allTools.js";
export { packageInfo } from "./common/packageInfo.js";
export { ExportedData } from "@mongodb-js/mcp-cli";

export {
    LoggerBase,
    type LogPayload,
    type LoggerType,
    type LogLevel,
    CompositeLogger,
    NoopLogger,
    type EventMap,
    type DefaultEventMap,
} from "@mongodb-js/mcp-core";
export { McpLogger } from "@mongodb-js/mcp-logging";
export { ConsoleLogger } from "@mongodb-js/mcp-logging";
export { StdioRunner } from "@mongodb-js/mcp-core";

// HTTP-specific transports
export {
    StreamableHttpRunner,
    MCPHttpServer,
    MonitoringServer,
    type StreamableHttpRunnerOptions,
    type MCPHttpServerOptions,
    type MonitoringServerOptions,
} from "@mongodb-js/mcp-http-runners";
export type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Web-friendly transports (from core)
export { type ITransportRunner, type TransportRequestContext } from "@mongodb-js/mcp-types";
export {
    ConnectionManager,
    MCPConnectionManager,
    type ConnectionStateConnected,
    type AnyConnectionState,
    type ConnectionState,
    type ConnectionStateConnecting,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type ConnectionManagerFactoryFn,
    type ConnectionManagerFactoryOptions,
    type ConnectionSettings,
    type ConnectionManagerEvents,
    type ConnectionTag,
    type OIDCConnectionAuthType,
} from "@mongodb-js/mcp-tools-mongodb";
export {
    connectionErrorHandler,
    type ConnectionErrorHandler,
    type ConnectionErrorHandled,
    type ConnectionErrorUnhandled,
    type ConnectionErrorHandlerContext,
} from "@mongodb-js/mcp-tools-mongodb";
export {
    ErrorCodes,
    MongoDBError,
    QUERY_COUNT_MAX_TIME_MS_CAP,
    AGG_COUNT_MAX_TIME_MS_CAP,
} from "@mongodb-js/mcp-tools-mongodb";
export { AtlasTelemetry, EventCache } from "@mongodb-js/mcp-atlas-telemetry";
export type {
    TelemetryEvent,
    TelemetryCommonProperties,
    TelemetryBaseEvent,
    TelemetryEvents,
    TelemetryConfig,
} from "@mongodb-js/mcp-atlas-telemetry";
export { Keychain, registerGlobalSecretToRedact } from "@mongodb-js/mcp-core";
export type { Secret } from "mongodb-redact";
export { Elicitation } from "@mongodb-js/mcp-core";
export { applyConfigOverrides, ConfigOverrideError, getConfigMeta, nameToConfigKey } from "@mongodb-js/mcp-cli";
export { onlyStricterLogLevelOverride } from "@mongodb-js/mcp-cli";
export { SessionStore, type ISessionStore, type SessionStoreConstructorArgs } from "@mongodb-js/mcp-core";
export type { CloseableTransport, SessionCloseReason } from "@mongodb-js/mcp-types";
export { ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
export { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
export type { MonitoringServerFeature } from "@mongodb-js/mcp-tools-mongodb";
export { ApiClient, type ApiClientOptions, type RequestContext } from "@mongodb-js/mcp-atlas-api-client";
export type { AuthProvider, Credentials } from "@mongodb-js/mcp-atlas-api-client";
export { type UIRegistryOptions, UIRegistry } from "@mongodb-js/mcp-ui";
export {
    type ToolExecutionContext,
    type AnyToolBase,
    type AnyToolClass,
    type OperationType,
    ToolBase,
    type ToolCategory,
    type ToolClass,
    type ToolArgs,
} from "@mongodb-js/mcp-core";
export { TRANSPORT_PAYLOAD_LIMITS, type TransportType } from "@mongodb-js/mcp-cli";
export {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
    type PrometheusMetricsOptions,
    Registry,
    Gauge,
    Histogram,
    Counter,
} from "@mongodb-js/mcp-metrics";
export {
    JSON_RPC_ERROR_CODE_PROCESSING_REQUEST_FAILED,
    JSON_RPC_ERROR_CODE_SESSION_ID_REQUIRED,
    JSON_RPC_ERROR_CODE_SESSION_ID_INVALID,
    JSON_RPC_ERROR_CODE_SESSION_NOT_FOUND,
    JSON_RPC_ERROR_CODE_INVALID_REQUEST,
    JSON_RPC_ERROR_CODE_DISALLOWED_EXTERNAL_SESSION,
} from "@mongodb-js/mcp-core";
