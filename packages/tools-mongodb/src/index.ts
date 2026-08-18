export {
    MongoDBToolBase,
    type IMongoDBConfig,
    type IMongoDBSession,
    type MongoDBToolRegistrationServer,
    ConnectionIdArgs,
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
    ConnectionDriverConfig,
    ConnectionManagerEvents,
    ConnectionTag,
    OIDCConnectionAuthType,
} from "./common/connectionManager.js";
export { MCPConnectionManager, ConnectionManager } from "./common/connectionManager.js";
export type {
    ConnectionStringInfo,
    ConnectionStringAuthType,
    AtlasClusterConnectionInfo,
    ConnectionStringHostType,
    ConnectionInfo,
} from "./common/connectionInfo.js";
export { getAuthType, getHostType, getConnectionStringInfo } from "./common/connectionInfo.js";
export { ErrorCodes, MongoDBError } from "./common/errors.js";
export type {
    ErrorCode,
    NotConnectedToMongoDBErrorCode,
    MisconfiguredConnectionStringErrorCode,
} from "./common/errors.js";
export { validateConnectionString } from "./helpers/connectionOptions.js";
export type { MonitoringServerFeature, PreviewFeature } from "./common/schemas.js";
export { previewFeatureValues, monitoringServerFeatureValues } from "./common/schemas.js";
export {
    ExportsManager,
    type JSONExportFormat,
    type AvailableExport,
    type CreateJSONExportParams,
    type ExportsManagerOptions,
    type StoredExport,
    type ExportsManagerEvents,
    type ReadyExport,
    type InProgressExport,
    type CommonExportData,
    jsonExportFormat,
    ensureExtension,
    isExportExpired,
} from "./common/exportsManager.js";
export {
    connectionErrorHandler,
    connectCapableTools,
    type ConnectionErrorHandler,
    type ConnectionErrorHandlerContext,
    type ConnectionErrorHandled,
    type ConnectionErrorUnhandled,
} from "./connectionErrorHandler.js";
export { DeviceId } from "./helpers/deviceId.js";
export { isObjectEmpty } from "./helpers/isObjectEmpty.js";
export { isNodeRuntime } from "./helpers/isNodeRuntime.js";
export {
    PRECONFIGURED_CONNECTION_ID,
    ConnectionEntry,
    atlasClusterSlug,
    buildEntryName,
    type ConnectionRegistry,
    type CreateConnectionOptions,
    type CreateConnectionEntryOptions,
    type ConnectionSource,
} from "./common/connectionRegistry.js";
export { MCPConnectionStore, type ConnectionStoreOptions } from "./common/connectionStore.js";
export { ConnectionSummarySchema, summarizeConnection } from "./common/connectionSummary.js";
export { FakeConnectionManager } from "./common/mocks/connectionManager.js";
export { buildWriteStageConfirmationMessage } from "./helpers/writeStageConfirmation.js";
export { bsonToJson } from "./helpers/bsonToJson.js";
export type { ListDatabasesOutput } from "./tools/metadata/listDatabases.js";
export { setAppNameParamIfMissing, type AppNameComponents } from "./helpers/connectionOptions.js";
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
    type CursorLimitKey,
} from "./helpers/constants.js";
export { pipelineDescriptionWithVectorSearch } from "./tools/read/aggregate.js";
export { FindOutputSchema } from "./tools/read/find.js";
export { IndexDirectionSchema, SortDirectionSchema } from "./mongodbSchemas.js";
export * from "./tools/tools.js";

import {
    AggregateTool,
    AggregateDBTool,
    ConnectTool,
    CountTool,
    FindTool,
    InsertManyTool,
    UpdateManyTool,
    DeleteManyTool,
    ExplainTool,
    ExportTool,
    DropIndexTool,
    DisconnectTool,
    ListConnectionsTool,
} from "./tools/tools.js";
import {
    CreateIndexTool,
    CreateCollectionTool,
    DropCollectionTool,
    DropDatabaseTool,
    RenameCollectionTool,
} from "./tools/tools.js";
import {
    ListCollectionsTool,
    ListDatabasesTool,
    CollectionIndexesTool,
    CollectionSchemaTool,
    CollectionStorageSizeTool,
    DbStatsTool,
    LogsTool,
} from "./tools/tools.js";
import type { ToolClass } from "@mongodb-js/mcp-core";
import type { IMongoDBSession } from "./mongodbTool.js";

export const MongoDBTools: ToolClass<IMongoDBSession>[] = [
    AggregateDBTool,
    AggregateTool,
    CollectionIndexesTool,
    CollectionSchemaTool,
    CollectionStorageSizeTool,
    ConnectTool,
    CountTool,
    CreateCollectionTool,
    CreateIndexTool,
    DbStatsTool,
    DeleteManyTool,
    DisconnectTool,
    DropCollectionTool,
    DropDatabaseTool,
    DropIndexTool,
    ExplainTool,
    ExportTool,
    FindTool,
    InsertManyTool,
    ListCollectionsTool,
    ListConnectionsTool,
    ListDatabasesTool,
    LogsTool,
    RenameCollectionTool,
    UpdateManyTool,
] as const;
