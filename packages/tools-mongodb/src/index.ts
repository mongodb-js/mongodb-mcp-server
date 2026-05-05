// Export base class and types
export { MongoDBToolBase } from "./mongodbTool.js";
export type { IMongoDBConfig } from "./mongodbConfig.js";
export type { IMongoDBSession, ConnectionErrorOutcome } from "./mongodbSession.js";

// Export connection-related classes
export {
    ConnectionManager,
    MCPConnectionManager,
    ConnectionStateConnected,
    type ConnectionSettings,
    type AnyConnectionState,
    type ConnectionManagerEvents,
    type ConnectionStateConnecting,
    type ConnectionStateDisconnected,
    type ConnectionStateErrored,
    type ConnectionManagerFactoryFn,
    defaultCreateConnectionManager,
    type IDeviceId,
    type IPackageInfo,
    type IUserConfig,
} from "./connection/connectionManager.js";

export {
    getConnectionStringInfo,
    type ConnectionStringInfo,
    type ConnectionStringAuthType,
    type ConnectionStringHostType,
    type AtlasClusterConnectionInfo,
    type OIDCConnectionAuthType,
} from "./connection/connectionInfo.js";

export {
    setAppNameParamIfMissing,
    validateConnectionString,
    type AppNameComponents,
} from "./connection/connectionOptions.js";

export { ErrorCodes, MongoDBError } from "./connection/errors.js";

// Export helpers
export { collectCursorUntilMaxBytesLimit } from "./helpers/collectCursorUntilMaxBytes.js";
export { operationWithFallback } from "./helpers/operationWithFallback.js";
export {
    assertVectorSearchFilterFieldsAreIndexed,
    collectFieldsFromVectorSearchFilter,
    type SearchIndex,
} from "./helpers/assertVectorSearchFilterFieldsAreIndexed.js";
export { isObjectEmpty } from "./helpers/isObjectEmpty.js";
export { usesIndex, getIndexCheckErrorMessage } from "./helpers/indexCheck.js";
export { zEJSON, toEJSON } from "./args.js";

// Export constants
export {
    QUERY_COUNT_MAX_TIME_MS_CAP,
    AGG_COUNT_MAX_TIME_MS_CAP,
    ONE_MB,
    CURSOR_LIMITS_TO_LLM_TEXT,
} from "./helpers/constants.js";

// Export schemas
export { IndexDirectionSchema, SortDirectionSchema, VectorSearchStage } from "./tools/mongodbSchemas.js";

// Export create tool output types
export type { CreateCollectionOutput } from "./tools/create/createCollection.js";
export type { InsertManyOutput } from "./tools/create/insertMany.js";
export type { CreateIndexOutput } from "./tools/create/createIndex.js";

// Export delete tool output types
export type { DeleteManyOutput } from "./tools/delete/deleteMany.js";
export type { DropCollectionOutput } from "./tools/delete/dropCollection.js";
export type { DropDatabaseOutput } from "./tools/delete/dropDatabase.js";
export type { DropIndexOutput } from "./tools/delete/dropIndex.js";

// Export update tool output types
export type { RenameCollectionOutput } from "./tools/update/renameCollection.js";
export type { UpdateManyOutput } from "./tools/update/updateMany.js";

// Export read tool schemas and args
export { pipelineDescriptionWithVectorSearch } from "./tools/read/aggregate.js";
export { FindArgs } from "./tools/read/find.js";

// Export metadata tool output types
export type { CollectionSchemaOutput } from "./tools/metadata/collectionSchema.js";
export type { CollectionIndexesOutput } from "./tools/metadata/collectionIndexes.js";
export type { CollectionStorageSizeOutput } from "./tools/metadata/collectionStorageSize.js";
export type { DbStatsOutput } from "./tools/metadata/dbStats.js";
export type { ExplainOutput } from "./tools/metadata/explain.js";
export type { ListCollectionsOutput } from "./tools/metadata/listCollections.js";
export type { ListDatabasesOutput } from "./tools/metadata/listDatabases.js";
export type { LogsOutput } from "./tools/metadata/logs.js";

// Export tools
export * from "./tools/tools.js";

// Export tools array
import * as tools from "./tools/tools.js";
export const MongoDBTools = Object.values(tools);
