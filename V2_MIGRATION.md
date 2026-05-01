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
