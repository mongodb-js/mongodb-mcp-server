export {
    Server,
    type ServerOptions,
    type MongoDBToolsRuntimeConfig,
    type AnyToolClass,
    type ToolCategory,
} from "./server.js";
export { Session, type SessionOptions, type SessionEvents } from "./common/session.js";
export { type UserConfig, UserConfigSchema, configRegistry } from "./common/config/userConfig.js";
export { parseUserConfig, defaultParserOptions, type ParserOptions } from "./common/config/parseUserConfig.js";

import { parseUserConfig } from "./common/config/parseUserConfig.js";
import type { UserConfig } from "./common/config/userConfig.js";

/** @deprecated Use `parseUserConfig` instead. */
export function parseArgsWithCliOptions(cliArguments: string[]): {
    warnings: string[];
    parsed: UserConfig | undefined;
    error: string | undefined;
} {
    return parseUserConfig({
        args: cliArguments,
    });
}

export { createAtlasLocalClient } from "@mongodb-js/mcp-tools-atlas-local";

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
export {
    StreamableHttpRunner,
    MCPHttpServer,
    MonitoringServer,
    type StreamableHttpRunnerOptions as StreamableHttpTransportRunnerConfig,
    type MonitoringServerConfig,
    type MCPHttpServerOptions,
    type MonitoringServerOptions,
} from "@mongodb-js/mcp-transports";
export type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
export { StdioRunner } from "@mongodb-js/mcp-transports";
export {
    TransportRunnerBase,
    type TransportRunnerBaseOptions as TransportRunnerConfig,
    type CustomizableServerOptions,
    type CustomizableSessionOptions,
    type TransportRequestContext,
} from "@mongodb-js/mcp-transports";
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
} from "./common/connectionErrorHandler.js";
export {
    ErrorCodes,
    MongoDBError,
    QUERY_COUNT_MAX_TIME_MS_CAP,
    AGG_COUNT_MAX_TIME_MS_CAP,
} from "@mongodb-js/mcp-tools-mongodb";
export { AtlasTelemetry, EventCache } from "@mongodb-js/mcp-atlas-telemetry";
export type {
    TelemetryEvent,
    TelemetryCommonProperties as CommonProperties,
    TelemetryBaseEvent as BaseEvent,
    TelemetryEvents,
    TelemetryConfig,
} from "@mongodb-js/mcp-atlas-telemetry";
export { Keychain, registerGlobalSecretToRedact } from "@mongodb-js/mcp-core";
export type { Secret } from "mongodb-redact";
export { Elicitation } from "./elicitation.js";
export { applyConfigOverrides, ConfigOverrideError } from "./common/config/configOverrides.js";
export { SessionStore, type ISessionStore, type SessionStoreConstructorArgs } from "@mongodb-js/mcp-transports";
export type { CloseableTransport, SessionCloseReason } from "@mongodb-js/mcp-types";
export { ExportsManager } from "@mongodb-js/mcp-tools-mongodb";
export { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
export type { MonitoringServerFeature } from "@mongodb-js/mcp-tools-mongodb";
export { ApiClient, type ApiClientOptions, type RequestContext } from "@mongodb-js/mcp-atlas-api-client";
export type { AuthProvider, Credentials } from "@mongodb-js/mcp-atlas-api-client";
export { type UIRegistryOptions, UIRegistry } from "@mongodb-js/mcp-ui";
export { type ToolExecutionContext, type AnyToolBase } from "./tools/tool.js";
export {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultMetrics,
    type Metrics,
    type MetricDefinitions,
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
} from "@mongodb-js/mcp-transports";
