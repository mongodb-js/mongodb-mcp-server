export {
    Server,
    type ServerOptions,
    type ServerRunnerOptions,
    type TelemetryMetadata,
    type AnyToolClass,
} from "./server.js";
export type { ServerResource } from "./resources/resource.js";
export { Session, type SessionOptions } from "./common/session.js";
export { type UserConfig, UserConfigSchema } from "./common/config/userConfig.js";
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
    ConsoleLogger,
    NullLogger,
} from "./common/logging/index.js";
export {
    StreamableHttpRunner,
    MCPHttpServer,
    MonitoringServer,
    createDefaultMonitoringServer,
    type StreamableHttpTransportRunnerConfig,
    type MonitoringServerConstructorArgs,
    type MonitoringServerConfig,
    type MCPHttpServerHttpConfig,
    type MCPServerFactory,
    type StdioRunnerConfig,
} from "@mongodb-mcp/transport";
export { StdioRunner } from "@mongodb-mcp/transport";
export { TransportRunnerBase, type TransportRunnerConfig } from "@mongodb-mcp/transport";
export {
    ConnectionManager,
    ConnectionStateConnected,
    type AnyConnectionState,
    type ConnectionState,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type ConnectionManagerFactoryFn,
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
export { DeviceId } from "./helpers/deviceId.js";
export { Keychain, registerGlobalSecretToRedact } from "./common/keychain.js";
export type { Secret } from "./common/keychain.js";
export { Elicitation } from "./elicitation.js";
export { applyConfigOverrides, ConfigOverrideError } from "./common/config/configOverrides.js";
export {
    SessionStore,
    createDefaultSessionStore,
    type ISessionStore,
    type CloseableTransport,
    type SessionCloseReason,
} from "@mongodb-mcp/transport";
export { ApiClient, type ApiClientOptions } from "./common/atlas/apiClient.js";
export type { AuthProvider } from "./common/atlas/auth/authProvider.js";
export { type UIRegistryOptions } from "./ui/registry/registry.js";
export { type ToolExecutionContext, type AnyToolBase } from "./tools/tool.js";
export { type RequestContext } from "@mongodb-mcp/transport";
export { PrometheusMetrics } from "@mongodb-mcp/monitoring";
export { createDefaultMetrics } from "@mongodb-mcp/monitoring";
export type { DefaultMetrics } from "@mongodb-mcp/monitoring";
export type { Metrics, MetricDefinitions } from "@mongodb-mcp/monitoring";
