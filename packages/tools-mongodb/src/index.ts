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
  MCPConnectionManager,
  ConnectionManagerFactoryFn,
  ConnectionManagerEvents,
  ConnectionTag,
  OIDCConnectionAuthType,
} from "./common/connectionManager.js";
export { defaultCreateConnectionManager } from "./common/connectionManager.js";
export type {
  ConnectionStringInfo,
  ConnectionStringAuthType,
  AtlasClusterConnectionInfo,
  ConnectionStringHostType,
} from "./common/connectionInfo.js";
export { getAuthType } from "./common/connectionInfo.js";
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
} from "./common/exportsManager.js";
export { DeviceId } from "./helpers/deviceId.js";
export { isObjectEmpty } from "./helpers/isObjectEmpty.js";
export { validateConnectionString } from "./helpers/connectionOptions.js";
export * from "./tools/tools.js";

import * as tools from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
export const MongoDBTools: ToolClass[] = Object.values(tools);
