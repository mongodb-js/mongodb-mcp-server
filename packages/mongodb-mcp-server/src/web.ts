/** This file is temporarily used for generating API reports against the v1 API for comparison purposes. */
export { type ITransportRunner, type TransportRequestContext } from "@mongodb-js/mcp-types";
export { createDefaultMetrics, type DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";
export type { ToolCategory } from "@mongodb-js/mcp-types";
export { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
export { LoggerBase, CompositeLogger, type EventMap, type DefaultEventMap } from "@mongodb-js/mcp-core";
export type { DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
export type {
    TelemetryCommonProperties,
    TelemetryBoolSet,
    TelemetryCommonStaticProperties,
    TelemetryResult,
    TelemetryToolMetadata,
    AtlasConnectionMetadata,
    AtlasMetadata,
    AtlasLocalToolMetadata,
    AtlasPerfAdvisorToolMetadata,
    AtlasStreamsToolMetadata,
    UpgradeClusterMetadata,
} from "@mongodb-js/mcp-atlas-telemetry";
export type { SessionEvents } from "@mongodb-js/mcp-types";
export type { LogLevel, LogPayload, LoggerType } from "@mongodb-js/mcp-core";
export { Keychain } from "@mongodb-js/mcp-core";
export type { Secret } from "mongodb-redact";
export type {
    ConnectionErrorHandler,
    ConnectionErrorHandled,
    ConnectionErrorUnhandled,
    ConnectionErrorHandlerContext,
} from "@mongodb-js/mcp-tools-mongodb";
export { Elicitation, type ElicitedInputResult } from "@mongodb-js/mcp-core";
export type {
    ConnectionStateConnecting,
    ConnectionSettings,
    ConnectionManagerFactoryFn,
    ConnectionManagerFactoryOptions,
    AtlasClusterConnectionInfo,
    ConnectionStringInfo,
    AnyConnectionState,
    ConnectionStateDisconnected,
    ConnectionStateErrored,
    ConnectionManagerEvents,
    ConnectionState,
    OIDCConnectionAuthType,
    ConnectionTag,
} from "@mongodb-js/mcp-tools-mongodb";
export type { ConnectionManager, ConnectionStateConnected } from "@mongodb-js/mcp-tools-mongodb";
export {
    ExportsManager,
    type AvailableExport,
    type ExportsManagerOptions,
    type JSONExportFormat,
    type StoredExport,
    type ExportsManagerEvents,
    type ReadyExport,
    type InProgressExport,
    type CommonExportData,
    jsonExportFormat,
} from "@mongodb-js/mcp-tools-mongodb";
export { ApiClient, type ApiClientOptions, type RequestContext } from "@mongodb-js/mcp-atlas-api-client";
export type { AtlasLocalClientFactoryFn, LibraryLoader } from "@mongodb-js/mcp-tools-atlas-local";
export { UIRegistry } from "@mongodb-js/mcp-ui";
export {
    ToolBase,
    type AnyToolBase,
    type ToolClass,
    type ToolConstructorParams,
    type OperationType,
    type ToolArgs,
    type ToolExecutionContext,
} from "@mongodb-js/mcp-core";
export { AtlasTelemetry as Telemetry, EventCache } from "@mongodb-js/mcp-atlas-telemetry";
export type {
    TelemetryEvents,
    TelemetryConfig,
    TelemetryEvent,
    TelemetryBaseEvent,
} from "@mongodb-js/mcp-atlas-telemetry";
export { getRandomUUID } from "@mongodb-js/mcp-core";
export type { AuthProvider } from "@mongodb-js/mcp-atlas-api-client";
export { ClientCredentialsAuthProvider } from "@mongodb-js/mcp-atlas-api-client";
export type { PreviewFeature, previewFeatureValues } from "@mongodb-js/mcp-tools-mongodb";
