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

export { defaultCreateApiClient } from "./common/atlas/apiClient.js";
export { defaultCreateAtlasLocalClient } from "./common/atlasLocal.js";

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
    createDefaultMcpHttpServer,
    type MCPHttpServerConstructorArgs,
    type CreateMcpHttpServerFn,
    MonitoringServer,
    createDefaultMonitoringServer,
    type StreamableHttpTransportRunnerConfig,
    type CreateMonitoringServerFn,
    type MonitoringServerConstructorArgs,
    type MonitoringServerConfig,
} from "./transports/streamableHttp.js";
export type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
export { StdioRunner } from "./transports/stdio.js";
export {
    TransportRunnerBase,
    type TransportRunnerConfig,
    type CustomizableServerOptions,
    type CustomizableSessionOptions,
    type CreateSessionConfigFn,
    type TransportRequestContext,
} from "./transports/base.js";
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
export { Telemetry } from "./telemetry/telemetry.js";
export { type TelemetryEvent, type CommonProperties, type BaseEvent } from "./telemetry/types.js";
export type { TelemetryEvents } from "./telemetry/telemetry.js";
export { EventCache } from "./telemetry/eventCache.js";
export { Keychain, registerGlobalSecretToRedact } from "@mongodb-js/mcp-core";
export type { Secret } from "mongodb-redact";
export { Elicitation } from "./elicitation.js";
export { applyConfigOverrides, ConfigOverrideError } from "./common/config/configOverrides.js";
export {
    SessionStore,
    createDefaultSessionStore,
    type ISessionStore,
    type CloseableTransport,
    type SessionCloseReason,
    type CreateSessionStoreFn,
    type SessionStoreConstructorArgs,
} from "./common/sessionStore.js";
export { ExportsManager } from "./common/exportsManager.js";
export { DeviceId } from "./helpers/deviceId.js";
export type { MonitoringServerFeature } from "./common/schemas.js";
export {
    ApiClient,
    type ApiClientOptions,
    type ApiClientFactoryFn,
    type RequestContext,
} from "./common/atlas/apiClient.js";
export type { AuthProvider, Credentials } from "./common/atlas/auth/authProvider.js";
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
