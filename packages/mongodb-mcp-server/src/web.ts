/** This file is temporarily used for generating API reports against the v1 API for comparison purposes. */
export { type ITransportRunner, type TransportRequestContext } from "@mongodb-js/mcp-types";
export { createDefaultMetrics, type DefaultPrometheusMetricDefinitions } from "@mongodb-js/mcp-metrics";
export type { ToolCategory } from "@mongodb-js/mcp-types";
export { DeviceId } from "@mongodb-js/mcp-tools-mongodb";
export { LoggerBase, CompositeLogger } from "@mongodb-js/mcp-core";
export { type LogLevel, type LogPayload, type LoggerType } from "@mongodb-js/mcp-types";
export { type EventMap, type DefaultEventMap } from "@mongodb-js/mcp-types";
export type { DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
export type {
    TelemetryCommonProperties,
    TelemetryBoolSet,
    TelemetryCommonStaticProperties,
    TelemetryResult,
    TelemetryToolMetadata,
    AtlasMetadata,
    AtlasLocalToolMetadata,
    UpgradeClusterMetadata,
} from "@mongodb-js/mcp-atlas-telemetry";
export type { ConnectionMetadata, PerfAdvisorToolMetadata, StreamsToolMetadata } from "@mongodb-js/mcp-types";
export type { SessionEvents } from "@mongodb-js/mcp-types";
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
export { ApiClient, type ApiClientOptions } from "@mongodb-js/mcp-atlas-api-client";
export type { AtlasLocalClientFactoryFn, LibraryLoader } from "@mongodb-js/mcp-tools-atlas-local";
export { UIRegistry } from "@mongodb-js/mcp-ui";
export {
    ToolBase,
    type AnyToolBase,
    type ToolClass,
    type ToolConstructorParams,
    type ToolArgs,
} from "@mongodb-js/mcp-core";
export { type OperationType } from "@mongodb-js/mcp-types";
export { type ToolExecutionContext } from "@mongodb-js/mcp-types";
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
