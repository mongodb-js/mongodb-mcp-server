export {
  MongoDBToolBase,
  type IMongoDBConfig,
  type IMongoDBSession,
  DBOperationArgs,
  CollOperationArgs,
} from "./mongodbTool.js";
export type {
  ConnectionSettings,
  ConnectionState,
  ConnectionStateConnected,
  ConnectionStateConnecting,
  ConnectionStateDisconnected,
  ConnectionStateErrored,
  AnyConnectionState,
  ConnectionManager,
  ConnectionManagerFactoryFn,
  ConnectionManagerEvents,
  ConnectionTag,
  OIDCConnectionAuthType,
} from "./common/connectionManager.js";
export { defaultCreateConnectionManager, MCPConnectionManager } from "./common/connectionManager.js";
export type {
  ConnectionStringInfo,
  ConnectionStringAuthType,
  AtlasClusterConnectionInfo,
  ConnectionStringHostType,
} from "./common/connectionInfo.js";
export { getAuthType, getHostType, getConnectionStringInfo } from "./common/connectionInfo.js";
export { ErrorCodes, MongoDBError } from "./common/errors.js";
export type { ErrorCode, NotConnectedToMongoDBErrorCode, MisconfiguredConnectionStringErrorCode } from "./common/errors.js";
export type { MonitoringServerFeature, PreviewFeature } from "./common/schemas.js";
export { previewFeatureValues, monitoringServerFeatureValues } from "./common/schemas.js";
export {
  ExportsManager,
  type JSONExportFormat,
  type AvailableExport,
  type ExportsManagerConfig,
  type StoredExport,
  type ExportsManagerEvents,
  type ReadyExport,
  type InProgressExport,
  type CommonExportData,
  jsonExportFormat,
  ensureExtension,
  isExportExpired,
} from "./common/exportsManager.js";
export { DeviceId } from "./helpers/deviceId.js";
export { isObjectEmpty } from "./helpers/isObjectEmpty.js";
export { validateConnectionString, setAppNameParamIfMissing, type AppNameComponents } from "./helpers/connectionOptions.js";
export { usesIndex, getIndexCheckErrorMessage, checkIndexUsage } from "./helpers/indexCheck.js";
export { collectCursorUntilMaxBytesLimit, getResponseBytesLimit } from "./helpers/collectCursorUntilMaxBytes.js";
export { operationWithFallback } from "./helpers/operationWithFallback.js";
export {
  assertVectorSearchFilterFieldsAreIndexed,
  collectFieldsFromVectorSearchFilter,
  type SearchIndex,
} from "./helpers/assertVectorSearchFilterFieldsAreIndexed.js";
export {
  QUERY_COUNT_MAX_TIME_MS_CAP,
  AGG_COUNT_MAX_TIME_MS_CAP,
  ONE_MB,
  CURSOR_LIMITS_TO_LLM_TEXT,
} from "./helpers/constants.js";
export { pipelineDescriptionWithVectorSearch } from "./tools/read/aggregate.js";
export { IndexDirectionSchema, SortDirectionSchema } from "./mongodbSchemas.js";
export * from "./tools/tools.js";

import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const MongoDBTools: ToolClass[] = Object.values(tools);
