# V2 Migration Guide

## Positional parameters replaced with options objects

All constructors now take a single options object instead of positional arguments.

### `LoggerBase`

```diff
- const logger = new LoggerBase(keychain);
+ const logger = new LoggerBase({ keychain });
```

Classes extending `LoggerBase` must update their `super()` calls accordingly.

### `ConsoleLogger`

```diff
- const logger = new ConsoleLogger(keychain);
+ const logger = new ConsoleLogger({ keychain });
```

### `DiskLogger`

```diff
- const logger = new DiskLogger(logPath, onError, keychain);
+ const logger = new DiskLogger({ logPath, onError, keychain });
```

### `McpLogger`

`McpLogger` now accepts an `McpServer` (from `@mongodb-js/mcp-core`) directly, plus a `mcpLogLevel` (static value or getter function).

```diff
- const logger = new McpLogger(server, keychain);
+ const logger = new McpLogger({
+     server: mcpServer,
+     mcpLogLevel: () => server.mcpLogLevel,
+     keychain,
+ });
```

## Telemetry moved to `@mongodb-js/mcp-atlas-telemetry`

The telemetry implementation has been extracted into a standalone package. All telemetry imports must be updated.

### Package

```diff
- import { Telemetry } from "mongodb-mcp-server";
+ import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";
```

### `Telemetry` renamed to `AtlasTelemetry`

```diff
- import { Telemetry } from "mongodb-mcp-server";
+ import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";

- const telemetry = Telemetry.create(session, userConfig, deviceId);
+ const telemetry = AtlasTelemetry.create({
+     logger,
+     deviceId,
+     apiClient,
+     keychain,              // now mandatory
+     enabled: true,
+     machineMetadata: buildMachineMetadata(packageName, packageVersion),
+ });
```

`machineMetadata` is now a required field. Use the `buildMachineMetadata(name, version)` helper exported from `@mongodb-js/mcp-atlas-telemetry` to construct it.

### Type renames

All telemetry types are now prefixed with `Telemetry` or `Atlas`:

| Old name                  | New name                             |
| ------------------------- | ------------------------------------ |
| `BaseEvent`               | `TelemetryBaseEvent`                 |
| `CommonProperties`        | `TelemetryCommonProperties`          |
| `CommonStaticProperties`  | `TelemetryCommonStaticProperties`    |
| `TelemetryEvent<T>`       | `TelemetryEvent<T>` (unchanged)      |
| `TelemetryResult`         | `TelemetryResult` (unchanged)        |
| `TelemetryBoolSet`        | `TelemetryBoolSet` (unchanged)       |
| `TelemetryToolMetadata`   | `TelemetryToolMetadata` (unchanged)  |
| `ToolEvent`               | `TelemetryToolEvent`                 |
| `ConnectionMetadata`      | `AtlasConnectionMetadata`            |
| `AtlasMetadata`           | `AtlasMetadata` (unchanged)          |
| `AtlasLocalToolMetadata`  | `AtlasLocalToolMetadata` (unchanged) |
| `PerfAdvisorToolMetadata` | `AtlasPerfAdvisorToolMetadata`       |
| `StreamsToolMetadata`     | `AtlasStreamsToolMetadata`           |
| `SetupStage`              | `TelemetrySetupStage`                |
| `SetupEvent`              | `TelemetrySetupEvent`                |
| `SetupEventProperties`    | `TelemetrySetupEventProperties`      |

### `EventCache` import

```diff
- import { EventCache } from "mongodb-mcp-server";
+ import { EventCache } from "@mongodb-js/mcp-atlas-telemetry";
```

### `NoopTelemetry` added to `@mongodb-js/mcp-core`

A `NoopTelemetry` class implementing `ITelemetry` is now available for use in tests or contexts where telemetry should be silently discarded:

```diff
+ import { NoopTelemetry } from "@mongodb-js/mcp-core";

+ const telemetry = new NoopTelemetry();
```

## MongoDB tools moved to `@mongodb-js/mcp-tools-mongodb`

All MongoDB-specific tools, connection management, and related utilities have been extracted into a standalone workspace package. This consolidates MongoDB functionality and makes it reusable across the monorepo.

### Package

```diff
- import { FindTool, MongoDBToolBase, ConnectionManager } from "mongodb-mcp-server";
+ import { FindTool, MongoDBToolBase, ConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
```

### Available exports

The following are now exported from `@mongodb-js/mcp-tools-mongodb`:

#### Tools
- `ConnectTool`, `SwitchConnectionTool`
- `FindTool`, `AggregateTool`, `AggregateDBTool`, `CountTool`, `ExportTool`
- `CreateIndexTool`, `InsertManyTool`, `CreateCollectionTool`
- `DeleteManyTool`, `DropIndexTool`, `DropCollectionTool`, `DropDatabaseTool`
- `UpdateManyTool`, `RenameCollectionTool`
- `CollectionSchemaTool`, `CollectionIndexesTool`, `CollectionStorageSizeTool`
- `DbStatsTool`, `ExplainTool`, `ListCollectionsTool`, `ListDatabasesTool`, `LogsTool`

#### Base classes and types
- `MongoDBToolBase` - Base class for all MongoDB tools
- `IMongoDBConfig` - Configuration interface for MongoDB tools
- `IMongoDBSession` - Session interface for MongoDB operations
- `ConnectionErrorOutcome` - Type for connection error handling

#### Connection management
- `ConnectionManager`, `MCPConnectionManager`
- `ConnectionStateConnected`, `ConnectionSettings`, `AnyConnectionState`
- `ConnectionManagerEvents`, `ConnectionStateConnecting`, `ConnectionStateDisconnected`
- `ConnectionStateErrored`, `ConnectionManagerFactoryFn`, `defaultCreateConnectionManager`
- `IDeviceId`, `IPackageInfo`, `IUserConfig`

#### Connection utilities
- `getConnectionStringInfo`, `ConnectionStringInfo`, `ConnectionStringAuthType`
- `ConnectionStringHostType`, `AtlasClusterConnectionInfo`, `OIDCConnectionAuthType`
- `setAppNameParamIfMissing`, `validateConnectionString`, `AppNameComponents`

#### Error handling
- `ErrorCodes` - MongoDB-specific error codes
- `MongoDBError` - MongoDB error class

#### Schemas
- `IndexDirectionSchema`, `SortDirectionSchema`, `VectorSearchStage`
- `pipelineDescriptionWithVectorSearch`, `FindArgs`

#### Output types
- `CreateCollectionOutput`, `InsertManyOutput`, `CreateIndexOutput`
- `DeleteManyOutput`, `DropCollectionOutput`, `DropDatabaseOutput`, `DropIndexOutput`
- `RenameCollectionOutput`, `UpdateManyOutput`
- `CollectionSchemaOutput`, `CollectionIndexesOutput`, `CollectionStorageSizeOutput`
- `DbStatsOutput`, `ExplainOutput`, `ListCollectionsOutput`, `ListDatabasesOutput`, `LogsOutput`

#### Helper functions
- `collectCursorUntilMaxBytesLimit` - Cursor batching utility
- `operationWithFallback` - Operation retry utility
- `assertVectorSearchFilterFieldsAreIndexed`, `collectFieldsFromVectorSearchFilter`
- `usesIndex`, `getIndexCheckErrorMessage` - Index checking utilities
- `isObjectEmpty` - Object validation
- `zEJSON`, `toEJSON` - EJSON parsing utilities

#### Constants
- `QUERY_COUNT_MAX_TIME_MS_CAP`, `AGG_COUNT_MAX_TIME_MS_CAP`
- `ONE_MB`, `CURSOR_LIMITS_TO_LLM_TEXT`

#### Tools array
- `MongoDBTools` - Array of all MongoDB tool classes

### Import changes for test files

Test files and utilities importing from `src/tools/mongodb/*` should now import from the new package:

```diff
- import type { CreateCollectionOutput } from "../../../src/tools/mongodb/create/createCollection.js";
+ import type { CreateCollectionOutput } from "@mongodb-js/mcp-tools-mongodb";

- import { collectCursorUntilMaxBytesLimit } from "../../../src/helpers/collectCursorUntilMaxBytes.js";
+ import { collectCursorUntilMaxBytesLimit } from "@mongodb-js/mcp-tools-mongodb";

- import { ErrorCodes, MongoDBError } from "../../../src/common/errors.js";
+ import { ErrorCodes, MongoDBError } from "@mongodb-js/mcp-tools-mongodb";
```

### Removed from root package

The following have been removed from the root `mongodb-mcp-server` package and must be imported from `@mongodb-js/mcp-tools-mongodb`:

- All MongoDB tools (`FindTool`, `AggregateTool`, etc.)
- `MongoDBToolBase`
- `ConnectionManager`, `MCPConnectionManager`
- Connection utilities in `src/helpers/connectionOptions.js` (moved to package)
- `ErrorCodes`, `MongoDBError` from `src/common/errors.js`
- Helper utilities: `collectCursorUntilMaxBytesLimit`, `operationWithFallback`, etc.
