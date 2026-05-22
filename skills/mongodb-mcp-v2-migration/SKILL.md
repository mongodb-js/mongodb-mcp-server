---
name: mongodb-mcp-v2-migration
description: >-
  Migrates consumer code from mongodb-mcp-server v1 to v2 scoped packages.
  Do not use mongodb-mcp-server as a library; use runMcpCli from
  @mongodb-js/mcp-cli for simple CLIs, or other @mongodb-js/mcp-* packages.
  Covers Server→CliServer, transport, telemetry, and tool imports.
---

# MongoDB MCP v1 → v2 migration

## `mongodb-mcp-server` is not a library

- **End users:** `npx mongodb-mcp-server` / MCPB binary only.
- **Do not** `npm install mongodb-mcp-server` and `import { … } from "mongodb-mcp-server"` in application code.
- **Do not** use `mongodb-mcp-server/tools` or `mongodb-mcp-server/web` as library entry points.

Use **`@mongodb-js/mcp-cli`** and other **`@mongodb-js/mcp-*`** packages instead.

## Simple CLI customization: `runMcpCli`

Default path for a custom Node CLI (same flow as the official binary). One call: parse config → handlers → create server → start stdio/HTTP.

```typescript
import {
  runMcpCli,
  Resources,
  DryRunHandler,
  HelpHandler,
  VersionHandler,
} from "@mongodb-js/mcp-cli";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

/** This should ideally be read or generated from package.json */
const serverMetadata: ServerMetadata = {
  mcpServerName: "my-product-mcp",
  version: "1.0.0",
  engines: { node: ">=24" },
};

const tools = [...MongoDBTools, ...AtlasTools /*, MyTool */];

await runMcpCli({
  args: process.argv.slice(2),
  serverMetadata,
  consoleLogger: console,
  onExit: (code) => process.exit(code),
  tools,
  resources: Resources,
  handlers: [
    new HelpHandler(),
    new VersionHandler(),
    new DryRunHandler({ tools, resources: Resources }),
  ],
});
```

| `RunMcpCliOptions` | Role                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `args`             | `process.argv.slice(2)`                                                                    |
| `serverMetadata`   | Product name/version for telemetry and driver `appName`                                    |
| `tools`            | `ToolClass[]` from `@mongodb-js/mcp-tools-*` + custom tools                                |
| `resources`        | e.g. `Resources` from `@mongodb-js/mcp-cli`                                                |
| `handlers?`        | `CliHandler[]` — return `true` from `handle()` to skip server start (help, setup, dry-run) |

Escalation: `createServicesFromUserConfig` + `startServer` (same package) → `CliServer` + `@mongodb-js/mcp-http-runners` for per-request HTTP.

## npm installs by use case

| Use case                            | `npm install`                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom CLI (most v1 embeds)         | `@mongodb-js/mcp-cli` + needed `@mongodb-js/mcp-tools-*`                                                                                                                                                                                                                 |
| End-user CLI only                   | `mongodb-mcp-server` as **binary** (npx), not as import                                                                                                                                                                                                                  |
| Stdio MCP host                      | `@mongodb-js/mcp-core`                                                                                                                                                                                                                                                   |
| HTTP MCP host                       | `@mongodb-js/mcp-core` `@mongodb-js/mcp-http-runners`                                                                                                                                                                                                                    |
| Official server stack               | `@mongodb-js/mcp-cli` `@mongodb-js/mcp-core` `@mongodb-js/mcp-http-runners` `@mongodb-js/mcp-metrics` `@mongodb-js/mcp-logging` `@mongodb-js/mcp-atlas-telemetry` `@mongodb-js/mcp-atlas-api-client` `@mongodb-js/mcp-tools-mongodb` (+ atlas/local/assistant as needed) |
| Config parsing / overrides          | `@mongodb-js/mcp-cli`                                                                                                                                                                                                                                                    |
| Custom tool                         | `@mongodb-js/mcp-core` `@mongodb-js/mcp-types`                                                                                                                                                                                                                           |
| MongoDB tools + connections         | `@mongodb-js/mcp-tools-mongodb`                                                                                                                                                                                                                                          |
| Atlas API tools                     | `@mongodb-js/mcp-tools-atlas` `@mongodb-js/mcp-atlas-api-client`                                                                                                                                                                                                         |
| Atlas Local tools                   | `@mongodb-js/mcp-tools-atlas-local`                                                                                                                                                                                                                                      |
| Assistant tools                     | `@mongodb-js/mcp-tools-assistant`                                                                                                                                                                                                                                        |
| Telemetry                           | `@mongodb-js/mcp-atlas-telemetry`                                                                                                                                                                                                                                        |
| Logging (`DiskLogger`, `McpLogger`) | `@mongodb-js/mcp-logging`                                                                                                                                                                                                                                                |
| Metrics                             | `@mongodb-js/mcp-metrics`                                                                                                                                                                                                                                                |
| UI resources                        | `@mongodb-js/mcp-ui`                                                                                                                                                                                                                                                     |
| Shared types                        | `@mongodb-js/mcp-types`                                                                                                                                                                                                                                                  |

### Library imports (correct packages)

| v1 (wrong)                 | v2 (use)                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ |
| `mongodb-mcp-server`       | `@mongodb-js/mcp-cli` + `@mongodb-js/mcp-tools-*` / `@mongodb-js/mcp-core` / … |
| `mongodb-mcp-server/tools` | `@mongodb-js/mcp-tools-mongodb`, `-atlas`, `-atlas-local`, `-assistant`        |
| `mongodb-mcp-server/web`   | Scoped packages per symbol (browser); not the `/web` barrel                    |

## Removed from v1 public API

These symbols existed on `main` and are **gone** from the v2 main entry. Do not import them.

`ApiClientFactoryFn`, `BaseEvent`, `CommonProperties`, `CreateMcpHttpServerFn`, `CreateMonitoringServerFn`, `CreateSessionConfigFn`, `CreateSessionStoreFn`, `Credentials`, `CustomizableServerOptions`, `CustomizableSessionOptions`, `MCPHttpServerConstructorArgs`, `MonitoringServerConfig`, `MonitoringServerConstructorArgs`, `NullLogger`, `RequestContext`, `Server`, `ServerOptions`, `Session`, `SessionOptions`, `StreamableHttpTransportRunnerConfig`, `Telemetry`, `TransportRunnerBase`, `TransportRunnerConfig`, `UIRegistryOptions`, `createDefaultMcpHttpServer`, `createDefaultMonitoringServer`, `createDefaultSessionStore`, `createMCPConnectionManager`, `defaultCreateApiClient`, `defaultCreateAtlasLocalClient`, `defaultCreateConnectionManager`, `parseArgsWithCliOptions`

## Renames and replacements

| v1                                      | v2                                                                                         | Package                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `import from "mongodb-mcp-server"`      | `@mongodb-js/mcp-cli` or specific `@mongodb-js/mcp-*`                                      | —                                                   |
| `Server`                                | `CliServer`                                                                                | `@mongodb-js/mcp-cli`                               |
| `ServerOptions`                         | `CliServerOptions`                                                                         | `@mongodb-js/mcp-cli`                               |
| `Session`                               | `CliSession`                                                                               | `@mongodb-js/mcp-cli`                               |
| `SessionOptions`                        | `CliSessionOptions`                                                                        | same                                                |
| `session.userConfig`                    | `session.config`                                                                           | —                                                   |
| `Telemetry`                             | `AtlasTelemetry`                                                                           | `@mongodb-js/mcp-atlas-telemetry`                   |
| `BaseEvent`                             | `TelemetryBaseEvent`                                                                       | `@mongodb-js/mcp-atlas-telemetry`                   |
| `CommonProperties`                      | `TelemetryCommonProperties`                                                                | `@mongodb-js/mcp-atlas-telemetry`                   |
| `NullLogger`                            | `NoopLogger`                                                                               | `@mongodb-js/mcp-core`                              |
| `RequestContext`                        | `TransportRequestContext`                                                                  | `@mongodb-js/mcp-types`                             |
| `parseArgsWithCliOptions`               | `parseUserConfig`                                                                          | `@mongodb-js/mcp-cli`                               |
| `DefaultMetrics`                        | `DefaultMetricDefinitions`                                                                 | `@mongodb-js/mcp-types` / `@mongodb-js/mcp-metrics` |
| `Metrics<T>`                            | `IMetrics<T>`                                                                              | `@mongodb-js/mcp-types`                             |
| `MCPHttpServerConstructorArgs`          | `MCPHttpServerOptions`                                                                     | `@mongodb-js/mcp-http-runners`                      |
| `MonitoringServerConstructorArgs`       | `MonitoringServerOptions`                                                                  | `@mongodb-js/mcp-http-runners`                      |
| `StreamableHttpTransportRunnerConfig`   | `StreamableHttpRunnerOptions` + wired `MCPHttpServer`                                      | `@mongodb-js/mcp-http-runners`                      |
| `TransportRunnerBase`                   | `ITransportRunner`                                                                         | `@mongodb-js/mcp-types`                             |
| `defaultCreateApiClient`                | construct `ApiClient` inline                                                               | `@mongodb-js/mcp-atlas-api-client`                  |
| `defaultCreateAtlasLocalClient`         | `createAtlasLocalClient`                                                                   | `@mongodb-js/mcp-tools-atlas-local`                 |
| `defaultCreateConnectionManager`        | `new MCPConnectionManager({...})`                                                          | `@mongodb-js/mcp-tools-mongodb`                     |
| `mongodb-mcp-server/tools` tool classes | same names from `@mongodb-js/mcp-tools-mongodb` / `-atlas` / `-atlas-local` / `-assistant` | scoped packages                                     |

## New on v2 main entry (were not public in v1)

`AGG_COUNT_MAX_TIME_MS_CAP`, `AllTools`, `AtlasTelemetry`, `CliServer`, `CliServerOptions`, `CliSession`, `CliSessionOptions`, `ClientCredentialsAuthProvider`, `CloseableTransport`, `ConnectionManagerFactoryOptions`, `DefaultPrometheusMetricDefinitions`, `ErrorCodes`, `ExportedData`, `ITransportRunner`, `MCPHttpServerOptions`, `McpLogger`, `McpSession`, `MonitoringServerOptions`, `NoopLogger`, `OperationType`, `PrometheusMetrics`, `PrometheusMetricsOptions`, `QUERY_COUNT_MAX_TIME_MS_CAP`, `SessionCloseReason`, `StreamableHttpRunnerOptions`, `TRANSPORT_PAYLOAD_LIMITS`, `TelemetryBaseEvent`, `TelemetryCommonProperties`, `TelemetryEvents`, `ToolArgs`, `ToolBase`, `ToolClass`, `TransportRequestContext`, `TransportType`, `configRegistry`, `createAtlasLocalClient`, `createDefaultMetrics`, `getConfigMeta`, `nameToConfigKey`, `onlyStricterLogLevelOverride`, `packageInfo`

`MCPHttpServer`, `MonitoringServer`, `StreamableHttpRunner`, `SessionStore` — import from `@mongodb-js/mcp-http-runners` / `@mongodb-js/mcp-core`, not `mongodb-mcp-server`.

## `CliServer` / `CliSession`

```diff
- import { Server, Session, type ServerOptions } from "mongodb-mcp-server";
+ import { runMcpCli, Resources } from "@mongodb-js/mcp-cli";
+ // or, if you need direct server access:
+ import { CliServer, CliSession, type CliServerOptions } from "@mongodb-js/mcp-cli";

- new Server({ session, userConfig: config, mcpServer, telemetry, metrics, ... });
+ new CliServer({ session, mcpServer, telemetry, metrics, serverMetadata: packageInfo, ... });
```

- `CliServerOptions` drops `userConfig` and `toolContext`; adds required `serverMetadata`.
- Config lives on `session.config` (`CliSession`), not `session.userConfig`.
- `ToolCategory` adds `"custom"`.

## Transport

### v1

```typescript
// Stdio
new StdioRunner({ userConfig: config });
await runner.start();

// HTTP — override runner.createServerForRequest
class CustomRunner extends StreamableHttpRunner {
  protected override async createServerForRequest({ request }) {
    return this.createServer({ userConfig: sessionConfig });
  }
}
```

### v2

Build server first; runners only attach transport. **`createServerForRequest` is on `MCPHttpServer`**, not `StreamableHttpRunner`. You may still `extends StreamableHttpRunner` for `start()` / `close()` or to bundle HTTP wiring in a subclass constructor.

```typescript
// Stdio
new StdioRunner({ logger, server: cliServer });
await runner.start();

// HTTP — override MCPHttpServer.createServerForRequest
class MyMCPHttpServer extends MCPHttpServer {
  protected override async createServerForRequest(
    request: TransportRequestContext
  ): Promise<CliServer> {
    return new CliServer({ /* per request */ });
  }
}

const sessionStore = new SessionStore({
  options: {
    idleTimeoutMS: config.idleTimeoutMs,
    notificationTimeoutMS: config.notificationTimeoutMs,
  },
  logger,
  metrics,
});

const mcpHttpServer = new MyMCPHttpServer({
  options: {
    http: {
      host: config.httpHost,
      port: config.httpPort,
      bodyLimit: config.httpBodyLimit,
      headers: config.httpHeaders,
      responseType: config.httpResponseType,
    },
    session: {
      idleTimeoutMs: config.idleTimeoutMs,
      notificationTimeoutMs: config.notificationTimeoutMs,
      externallyManagedSessions: config.externallyManagedSessions,
    },
  },
  logger,
  metrics,
  sessionStore,
});

new StreamableHttpRunner({
  logger,
  metrics,
  mcpHttpServer,
  sessionStore,
  monitoringServer, // optional MonitoringServer({ options: { http, features }, logger, metrics })
});

// Optional: subclass runner to hide wiring (no createServerForRequest on runner)
class MyStreamableHttpRunner extends StreamableHttpRunner {
  constructor(/* deps */) {
    super({ logger, metrics, mcpHttpServer: new MyMCPHttpServer({...}), sessionStore, monitoringServer });
  }
}
```

`SessionStore` → `idleTimeoutMS` / `notificationTimeoutMS`. `MCPHttpServer` session → `idleTimeoutMs` / `notificationTimeoutMs`.

## Telemetry

```diff
- import { Telemetry, type BaseEvent, type CommonProperties } from "mongodb-mcp-server";
+ import { AtlasTelemetry, type TelemetryBaseEvent, type TelemetryCommonProperties } from "@mongodb-js/mcp-atlas-telemetry";

- Telemetry.create(session, userConfig, deviceId, { getCommonProperties: () => ({...}) });
+ AtlasTelemetry.create({
+   logger,
+   deviceId,
+   apiClient,
+   keychain,
+   enabled: config.telemetry === "enabled",
+   serverMetadata: packageInfo,
+ });
```

| v1 `TelemetryConfig`                       | v2                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `getCommonProperties?` callback            | subclass `AtlasTelemetry`, override `getCommonProperties()`, call `super` |
| `keychain?` optional                       | `keychain` required                                                       |
| no `serverMetadata`                        | `serverMetadata: ServerMetadata` required                                 |
| `machineMetadata` / `buildMachineMetadata` | removed; pipeline maps `serverMetadata`                                   |

Tests: `NoopTelemetry` from `@mongodb-js/mcp-core`.

## Constructor shape changes (still exported, different args)

```diff
- new LoggerBase(keychain);
+ new LoggerBase({ keychain });

- new ConsoleLogger(keychain);
+ new ConsoleLogger({ keychain });

- new CompositeLogger(a, b);
+ new CompositeLogger({ loggers: [a, b], keychain });

- new ApiClient(options, logger, authProvider);
+ new ApiClient({ options: { baseUrl, userAgent }, logger, authProvider });

- new MCPConnectionManager(userConfig, logger, deviceId);
+ new MCPConnectionManager({
+   logger,
+   deviceId,
+   options: { connectionInfo: config, displayName, version },
+ });

- new ConnectionStateConnected(sp, info, atlas);
+ new ConnectionStateConnected({ serviceProvider: sp, connectionStringInfo: info, connectedAtlasCluster: atlas });
```

`McpLogger` (`@mongodb-js/mcp-logging`):

```typescript
new McpLogger({
  server: mcpServer,
  options: { logLevel: server.mcpLogLevel },
  keychain,
});
```

`DiskLogger`: `new DiskLogger({ logWriter, keychain, ... })` — no positional `logPath`.

## Tools (`mongodb-mcp-server/tools`)

```diff
- import { FindTool, MongoDBToolBase } from "mongodb-mcp-server/tools";
+ import { FindTool, MongoDBToolBase } from "@mongodb-js/mcp-tools-mongodb";

- import { AllTools } from "mongodb-mcp-server/tools";
+ import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
+ import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
+ const tools = [...MongoDBTools, ...AtlasTools];
```

Bundles: `MongoDBTools` → `@mongodb-js/mcp-tools-mongodb`, `AtlasTools` → `@mongodb-js/mcp-tools-atlas`, `AtlasLocalTools` → `@mongodb-js/mcp-tools-atlas-local`, `AssistantTools` → `@mongodb-js/mcp-tools-assistant`.

`ToolBase` / `ToolClass`: fewer generics (`ToolBase<TSession>`, not three type params). MongoDB tools need full `IMongoDBConfig` on session config (use `UserConfigSchema.parse` for defaults).

## Config overrides

```diff
- applyConfigOverrides({ baseConfig, request?: RequestContext });
+ applyConfigOverrides({ baseConfig, request?: TransportRequestContext });
```

Also exported: `getConfigMeta`, `nameToConfigKey`, `onlyStricterLogLevelOverride` (`@mongodb-js/mcp-cli`).

## Metrics

```diff
- Metrics<DefaultMetrics>
+ IMetrics<DefaultMetricDefinitions>

- createDefaultMetrics() with old types
+ PrometheusMetrics, createDefaultMetrics from @mongodb-js/mcp-metrics
```

## Symbols still on barrel (unchanged names)

`UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `Keychain`, `Elicitation`, `ApiClient`, `ConnectionManager`, `MCPConnectionManager`, `connectionErrorHandler`, `ErrorCodes`, `MongoDBError`, `EventCache`, `ExportsManager`, `DeviceId`, `UIRegistry`, `SessionStore`, `JSON_RPC_ERROR_CODE_*`, `packageInfo` (new), etc.

## In-repo wiring examples

`packages/cli/src/createServicesFromUserConfig.ts` — `CliSession`, `MCPConnectionManager`, `AtlasTelemetry`, `CliServer`.

`packages/cli/src/startServer.ts` — `StdioRunner({ logger, server })`, `SessionStore`, `MCPHttpServer`, `StreamableHttpRunner`.

`packages/integration-tests/src/integrationHelpers.ts` — in-memory `CliServer` setup.

`packages/integration-tests/src/transports/streamableHttpMcpHttpServer.test.ts` — per-request `createServerForRequest`.
