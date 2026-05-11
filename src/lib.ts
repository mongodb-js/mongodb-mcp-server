export { Server, type ServerOptions, type AnyToolClass, type ToolCategory } from "./server.js";
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

import { defaultCreateConnectionManager } from "./common/connectionManager.js";
/** @deprecated Use `defaultCreateConnectionManager` instead. */
const createMCPConnectionManager = defaultCreateConnectionManager;
export { createMCPConnectionManager, defaultCreateConnectionManager };

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
    ConnectionStateConnected,
    type AnyConnectionState,
    type ConnectionState,
    type ConnectionStateConnecting,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type ConnectionManagerFactoryFn,
    type ConnectionSettings,
    type ConnectionManagerEvents,
    type ConnectionTag,
    type OIDCConnectionAuthType,
} from "./common/connectionManager.js";
export {
    connectionErrorHandler,
    type ConnectionErrorHandler,
    type ConnectionErrorHandled,
    type ConnectionErrorUnhandled,
    type ConnectionErrorHandlerContext,
} from "./common/connectionErrorHandler.js";
export { ErrorCodes, MongoDBError } from "./common/errors.js";
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
export { ExportsManager } from "./common/exportsManager.js";
export { DeviceId } from "./helpers/deviceId.js";
export type { MonitoringServerFeature } from "./common/schemas.js";
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
