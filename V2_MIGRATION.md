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
- `IMongoDBConfig` - Configuration type for MongoDB tools (see below)
- `IMongoDBSession` - Session interface for MongoDB operations
- `ConnectionErrorOutcome` - Type for connection error handling

#### Connection management

- `ConnectionManager`, `MCPConnectionManager`
- `ConnectionStateConnected`, `ConnectionSettings`, `AnyConnectionState`
- `ConnectionManagerEvents`, `ConnectionStateConnecting`, `ConnectionStateDisconnected`
- `ConnectionStateErrored`, `ConnectionManagerFactoryFn`, `ConnectionManagerFactoryOptions`
- `IDeviceId`, `IPackageInfo`, `IUserConfig`

`MCPConnectionManager` (and `ConnectionManagerFactoryOptions` passed to `createConnectionManager`) require **`options`**: **`connectionInfo`** (the transport / browser hints type now exported as `ConnectionInfo`), **`displayName`**, and **`version`** (combined into the driver `appName` segment). The MongoDB MCP Server sets `connectionInfo` from `userConfig` and `displayName` / `version` from `packageInfo` when using the built-in transport runners. The tools package does not ship its own generated `packageInfo` file.

#### Connection utilities

- `getConnectionStringInfo`, `ConnectionStringInfo`, `ConnectionStringAuthType`
- `ConnectionStringHostType`, `AtlasClusterConnectionInfo`, `OIDCConnectionAuthType`
- `ConnectionInfo` - Transport / HTTP host hints for OIDC auth inference (previously exported as `ConnectionInfoOptions`)
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

- `MongoDBTools` - Array of all MongoDB tool classes (`ToolClass<IMongoDBConfig>[]`)

### `IMongoDBConfig` and `MongoDBToolBase`

`IMongoDBConfig` is a **type** (not a separate runtime value) that intersects `IToolConfig` with MongoDB-specific fields. Those Mongo fields are **required keys on the type**: `connectionString`, `indexCheck`, `maxTimeMS`, `maxDocumentsPerQuery`, `maxBytesPerQuery`, and `httpHost`.

For settings that may be unset at runtime, `connectionString` and `maxTimeMS` are typed as `string | undefined` and `number | undefined` respectively—the properties must still exist on the object; use `undefined` when there is no value.

`MongoDBToolBase` **does not** fill in defaults in its constructor anymore (for example, it no longer applies `maxDocumentsPerQuery ?? 100`). Callers must pass a config object that already satisfies `IMongoDBConfig`, typically by using parsed server configuration (for example `UserConfigSchema.parse(...)`) where schema defaults supply fields such as `maxDocumentsPerQuery`.

Built-in MongoDB tool constructors expect `ToolConstructorParams<IMongoDBConfig>`. The exported `MongoDBTools` array is typed as `ToolClass<IMongoDBConfig>[]`, not `ToolClass[]`.

If you combine MongoDB tools with other tools behind a parameter typed as `ToolClass` (the default generic uses `IToolConfig`), TypeScript may reject the mixed array because MongoDB tool constructors require the narrower config. In that situation, widen the type—for example `AnyToolClass[]` from `mongodb-mcp-server` (exported alongside `Server`; equivalent to `ToolClass<any, any, any>[]`)—or keep MongoDB-only lists typed as `ToolClass<IMongoDBConfig>[]`.

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
