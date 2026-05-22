# V2 Migration Guide

Migrate from the v1 **single-package** API (`mongodb-mcp-server` on `main`) to the v2 **monorepo** API.

> Are you migrating using a coding agent? You can use the [MongoDB MCP v1 → v2 migration skill](skills/mongodb-mcp-v2-migration/SKILL.md)!

## Do not use `mongodb-mcp-server` as a library

The `mongodb-mcp-server` npm package is the **shipped CLI binary** (`npx mongodb-mcp-server`, MCPB bundle). **Do not** add it as a library dependency for embedding or customization.

| Need                                               | Use instead                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom branded CLI (tools, resources, extra flags) | [`@mongodb-js/mcp-cli`](#simple-cli-customization-runmcpcli) — `runMcpCli`                                                                        |
| Lower-level server / HTTP / per-request control    | `@mongodb-js/mcp-cli` (`CliServer`, `createServicesFromUserConfig`, `startServer`) plus `@mongodb-js/mcp-http-runners`, `@mongodb-js/mcp-core`, … |
| Tool classes only                                  | `@mongodb-js/mcp-tools-mongodb`, `@mongodb-js/mcp-tools-atlas`, …                                                                                 |
| Browser build                                      | Scoped packages (see [web-oriented imports](#scoped-packages)); not `mongodb-mcp-server/web` as a long-term library entry                         |

The root package may still re-export symbols for transitional API reports; new integrations should depend on **`@mongodb-js/mcp-*`** packages directly.

## Simple CLI customization: `runMcpCli`

For the common case — **a Node CLI that behaves like `mongodb-mcp-server` but with your tools, resources, or handlers** — use `runMcpCli` from `@mongodb-js/mcp-cli`. This is what the official binary does ([`packages/mongodb-mcp-server/src/index.ts`](packages/mongodb-mcp-server/src/index.ts)).

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

const serverMetadata: ServerMetadata = {
  mcpServerName: "my-mcp-server",
  version: "1.0.0",
  engines: { node: process.version },
};

const tools = [...MongoDBTools, ...AtlasTools /*, MyCustomTool */];

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
    // new MySetupHandler(),
  ],
});
```

`runMcpCli` parses argv/env (`parseUserConfig`), runs optional `CliHandler`s (help, version, setup, dry-run), builds the server (`createServicesFromUserConfig`), and starts stdio or HTTP transport (`startServer`). You only supply `serverMetadata`, `tools`, `resources`, and optional `handlers`.

Use **`createServicesFromUserConfig` + `startServer`** only when you need to customize wiring between parse and listen. Use **`CliServer` + runners** directly only for advanced hosts (e.g. per-request HTTP servers).

## Package selection by use case

### Entry points (avoid as libraries)

| Entry                              | Role                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `mongodb-mcp-server` (binary)      | End-user CLI only — not a library dependency                                                    |
| `mongodb-mcp-server/tools`, `/web` | Legacy convenience re-exports — import from `@mongodb-js/mcp-tools-*` / scoped packages instead |

### Scoped packages

| Use case                    | Install                                                                                                                                                                                                                                        | Primary imports                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Host MCP over stdio         | `@mongodb-js/mcp-core`                                                                                                                                                                                                                         | `StdioRunner`, `SessionStore`, `InMemoryTransport`, `Keychain`, `Elicitation`, `NoopTelemetry` |
| Host MCP over HTTP          | `@mongodb-js/mcp-http-runners`, `@mongodb-js/mcp-core`                                                                                                                                                                                         | `StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`                                    |
| Custom CLI (recommended)    | `@mongodb-js/mcp-cli` + tool packages                                                                                                                                                                                                          | `runMcpCli`, `Resources`, `CliHandler`, `HelpHandler`, …                                       |
| Embed server (advanced)     | `@mongodb-js/mcp-cli`, `@mongodb-js/mcp-core`, `@mongodb-js/mcp-http-runners`, `@mongodb-js/mcp-metrics`, `@mongodb-js/mcp-logging`, `@mongodb-js/mcp-atlas-telemetry`, `@mongodb-js/mcp-atlas-api-client`, `@mongodb-js/mcp-tools-mongodb`, … | `CliServer`, `CliSession`, `createServicesFromUserConfig`, `startServer`                       |
| Config / CLI parsing only   | `@mongodb-js/mcp-cli`                                                                                                                                                                                                                          | `UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `configRegistry`  |
| Custom tools (any category) | `@mongodb-js/mcp-core`, `@mongodb-js/mcp-types`                                                                                                                                                                                                | `ToolBase`, `ToolClass`, `OperationType`, `ToolCategory`                                       |
| MongoDB tools + connections | `@mongodb-js/mcp-tools-mongodb`                                                                                                                                                                                                                | `FindTool`, `MongoDBToolBase`, `MCPConnectionManager`, `ErrorCodes`, `MongoDBError`            |
| Atlas Admin API tools       | `@mongodb-js/mcp-tools-atlas`, `@mongodb-js/mcp-atlas-api-client`                                                                                                                                                                              | `AtlasTools`, `ApiClient`, `ClientCredentialsAuthProvider`                                     |
| Atlas Local tools           | `@mongodb-js/mcp-tools-atlas-local`                                                                                                                                                                                                            | `AtlasLocalTools`, `createAtlasLocalClient`                                                    |
| Assistant / knowledge tools | `@mongodb-js/mcp-tools-assistant`                                                                                                                                                                                                              | `AssistantTools`                                                                               |
| Telemetry pipeline          | `@mongodb-js/mcp-atlas-telemetry`                                                                                                                                                                                                              | `AtlasTelemetry`, `EventCache`, `TelemetryConfig`                                              |
| Logging                     | `@mongodb-js/mcp-logging`                                                                                                                                                                                                                      | `ConsoleLogger`, `DiskLogger`, `McpLogger`                                                     |
| Metrics                     | `@mongodb-js/mcp-metrics`                                                                                                                                                                                                                      | `PrometheusMetrics`, `createDefaultMetrics`                                                    |
| MCP UI resources            | `@mongodb-js/mcp-ui`                                                                                                                                                                                                                           | `UIRegistry`                                                                                   |
| Shared types                | `@mongodb-js/mcp-types`                                                                                                                                                                                                                        | `TransportRequestContext`, `ITransportRunner`, `ISession`, `ServerMetadata`, …                 |

### Minimal examples

**Custom MongoDB tool only**

```bash
npm install @mongodb-js/mcp-core @mongodb-js/mcp-types @mongodb-js/mcp-tools-mongodb
```

**HTTP MCP host with per-request config**

```bash
npm install @mongodb-js/mcp-core @mongodb-js/mcp-http-runners @mongodb-js/mcp-cli @mongodb-js/mcp-metrics @mongodb-js/mcp-logging
```

**Custom CLI (replaces most v1 `mongodb-mcp-server` embeds)**

```bash
npm install @mongodb-js/mcp-cli @mongodb-js/mcp-tools-mongodb @mongodb-js/mcp-tools-atlas
# add @mongodb-js/mcp-tools-atlas-local, @mongodb-js/mcp-tools-assistant as needed
```

---

## Quick reference: removed / renamed public symbols

From API report diff (`origin/main` → current). Symbols **removed** from `mongodb-mcp-server` public API:

| v1 symbol                                                                                                                    | v2 replacement / notes                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Server`                                                                                                                     | `CliServer` from `@mongodb-js/mcp-cli`                                                      |
| `Session`                                                                                                                    | `CliSession` / `McpSession` from `@mongodb-js/mcp-cli`                                      |
| `import { … } from "mongodb-mcp-server"` (library)                                                                           | Use `@mongodb-js/mcp-cli` or specific `@mongodb-js/mcp-*` package                           |
| `ServerOptions`                                                                                                              | `CliServerOptions` (no `userConfig`; use `session.config`)                                  |
| `Telemetry`                                                                                                                  | `AtlasTelemetry` from `@mongodb-js/mcp-atlas-telemetry`                                     |
| `Telemetry.create(session, userConfig, deviceId)`                                                                            | `AtlasTelemetry.create({ logger, deviceId, apiClient, keychain, enabled, serverMetadata })` |
| `BaseEvent`                                                                                                                  | `TelemetryBaseEvent`                                                                        |
| `CommonProperties`                                                                                                           | `TelemetryCommonProperties`                                                                 |
| `RequestContext` (config overrides)                                                                                          | `TransportRequestContext` from `@mongodb-js/mcp-types`                                      |
| `NullLogger`                                                                                                                 | `NoopLogger` from `@mongodb-js/mcp-core`                                                    |
| `TransportRunnerBase`                                                                                                        | Removed; use `ITransportRunner`                                                             |
| `TransportRunnerConfig`                                                                                                      | Removed; pass options to runners / servers directly                                         |
| `StreamableHttpTransportRunnerConfig`                                                                                        | `StreamableHttpRunnerOptions` + explicit `MCPHttpServer` / `SessionStore`                   |
| `CustomizableServerOptions` / `CustomizableSessionOptions`                                                                   | Removed                                                                                     |
| `CreateSessionConfigFn`                                                                                                      | Extend `MCPHttpServer` and override `createServerForRequest()`                              |
| `createDefaultMcpHttpServer` / `createDefaultMonitoringServer` / `createDefaultSessionStore`                                 | `new MCPHttpServer(...)`, `new MonitoringServer(...)`, `new SessionStore(...)`              |
| `MCPHttpServerConstructorArgs`                                                                                               | `MCPHttpServerOptions` with nested `options: { http, session }`                             |
| `MonitoringServerConstructorArgs`                                                                                            | `MonitoringServerOptions` with nested `options: { http, features }`                         |
| `parseArgsWithCliOptions`                                                                                                    | `parseUserConfig`                                                                           |
| `defaultCreateApiClient` / `defaultCreateAtlasLocalClient` / `defaultCreateConnectionManager` / `createMCPConnectionManager` | Wire dependencies explicitly (see `createServicesFromUserConfig`)                           |
| `ApiClientFactoryFn`                                                                                                         | Construct `ApiClient` directly                                                              |
| `UIRegistryOptions` (exported type)                                                                                          | Options still accepted; type may be internal — use inline object                            |

Symbols **added** on the main entry (install or import as listed):

`CliServer`, `CliSession`, `AtlasTelemetry`, `AllTools`, `packageInfo`, `configRegistry`, `getConfigMeta`, `nameToConfigKey`, `createAtlasLocalClient`, `ClientCredentialsAuthProvider`, `PrometheusMetrics`, `McpLogger`, `TransportRequestContext`, `MCPHttpServerOptions`, `MonitoringServerOptions`, `StreamableHttpRunnerOptions`, `TelemetryConfig`, `TelemetryBaseEvent`, `TelemetryCommonProperties`, and others — see the v2 API report.

---

## Server and session

### `Server` → `CliServer`

```diff
- import { Server, type ServerOptions } from "mongodb-mcp-server";
+ import { CliServer, type CliServerOptions } from "@mongodb-js/mcp-cli";
```

```diff
- const server = new Server({
-   session,
-   userConfig: config,
-   mcpServer,
-   telemetry,
-   ...
- });
+ const server = new CliServer({
+   session,
+   mcpServer,
+   telemetry,
+   serverMetadata: packageInfo,
+   ...
+ });
```

- `userConfig` is no longer on the server; read **`session.config`** (`CliSession.config`).
- `serverMetadata` is **required** on `CliServerOptions`.
- `metrics` type is `IMetrics<T>` (was `Metrics<T>` / `DefaultMetrics` → `DefaultMetricDefinitions`).

### `Session` → `CliSession`

```diff
- import { Session, type SessionOptions } from "mongodb-mcp-server";
+ import { CliSession, type CliSessionOptions } from "@mongodb-js/mcp-cli";
```

```diff
- session.userConfig
+ session.config
```

---

## Transport runners

Runners no longer accept `userConfig` or create the server internally. Build `CliServer` (or your `SessionServer`), then pass it to the runner.

### `StdioRunner`

```diff
- const runner = new StdioRunner({ userConfig: config });
- await runner.start();
+ const runner = new StdioRunner({ logger, server });
+ await runner.start();
```

Import: `@mongodb-js/mcp-core`.

### `StreamableHttpRunner` + `MCPHttpServer`

**Per-request server creation** moved off the runner. In v1, `createServerForRequest` lived on `StreamableHttpRunner`; in v2 it lives on **`MCPHttpServer`**.

You can still **`extends StreamableHttpRunner`** to customize `start()` / `close()` or to encapsulate wiring (build a custom `MCPHttpServer` subclass in the constructor and pass it to `super`). Override **`createServerForRequest` on `MCPHttpServer`**, not on the runner.

`TransportRequestContext` lives in **`@mongodb-js/mcp-types`**.

```typescript
import { SessionStore } from "@mongodb-js/mcp-core";
import {
  StreamableHttpRunner,
  MCPHttpServer,
  MonitoringServer,
} from "@mongodb-js/mcp-http-runners";
import { CliServer } from "@mongodb-js/mcp-cli";
import type { TransportRequestContext } from "@mongodb-js/mcp-types";

class MyMCPHttpServer extends MCPHttpServer {
  protected override async createServerForRequest(
    request: TransportRequestContext
  ): Promise<CliServer> {
    // Per-request CliServer / session / config
    return new CliServer({
      /* ... */
    });
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

const runner = new StreamableHttpRunner({
  logger,
  metrics,
  mcpHttpServer,
  sessionStore,
  monitoringServer, // optional
});
```

Note: `SessionStore` uses **`idleTimeoutMS`** / **`notificationTimeoutMS`** (capital `MS`); `MCPHttpServer` session options use **`idleTimeoutMs`** / **`notificationTimeoutMs`**.

### UserConfig field mapping (HTTP)

| v1 `UserConfig` field                                                          | v2 destination                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `transport`                                                                    | Choose `StdioRunner` vs `StreamableHttpRunner`                        |
| `httpHost` / `httpPort` / `httpBodyLimit` / `httpHeaders` / `httpResponseType` | `MCPHttpServerOptions.options.http.*`                                 |
| `idleTimeoutMs` / `notificationTimeoutMs`                                      | `SessionStore.options.*` and `MCPHttpServerOptions.options.session.*` |
| `externallyManagedSessions`                                                    | `MCPHttpServerOptions.options.session.externallyManagedSessions`      |
| `monitoringServerHost` / `monitoringServerPort` / `monitoringServerFeatures`   | `MonitoringServerOptions.options.http` / `.features`                  |

---

## Telemetry

Implementation package: **`@mongodb-js/mcp-atlas-telemetry`**.

```diff
- import { Telemetry } from "mongodb-mcp-server";
+ import { AtlasTelemetry } from "@mongodb-js/mcp-atlas-telemetry";

- const telemetry = Telemetry.create(session, userConfig, deviceId);
+ const telemetry = AtlasTelemetry.create({
+   logger,
+   deviceId,
+   apiClient,
+   keychain,
+   enabled: config.telemetry === "enabled",
+   serverMetadata: packageInfo,
+ });
```

| v1                                                  | v2                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `machineMetadata` / `buildMachineMetadata`          | `serverMetadata: ServerMetadata` (required)                                    |
| `getCommonProperties` callback on `TelemetryConfig` | Subclass `AtlasTelemetry`, override `getCommonProperties()`, call `super`      |
| Container detection callback                        | Override protected `detectContainerEnv()` or use exported `detectContainerEnv` |
| `keychain?` optional                                | `keychain` **required**                                                        |
| `BaseEvent`                                         | `TelemetryBaseEvent`                                                           |
| `CommonProperties`                                  | `TelemetryCommonProperties`                                                    |

Tests / no-op: `NoopTelemetry` from `@mongodb-js/mcp-core`.

Browser builds: import `AtlasTelemetry` from `@mongodb-js/mcp-atlas-telemetry` (do not rely on `mongodb-mcp-server/web`).

---

## Logging

Constructors take a single **options object** (`LoggerConfig`: `{ keychain }`).

```diff
- new LoggerBase(keychain);
+ new LoggerBase({ keychain });

- new ConsoleLogger(keychain);
+ new ConsoleLogger({ keychain });

- new DiskLogger(logPath, onError, keychain);
+ import { DiskLogger } from "@mongodb-js/mcp-logging";
+ new DiskLogger({ logWriter, keychain, ... });
```

`McpLogger` (`@mongodb-js/mcp-logging`):

```typescript
new McpLogger({
  server: mcpServer,
  options: { logLevel: () => server.mcpLogLevel },
  keychain,
});
```

`CompositeLogger` now accepts `{ keychain?, loggers: LoggerBase[] }` instead of rest parameters.

---

## Connection management

Import from **`@mongodb-js/mcp-tools-mongodb`**.

```diff
- new MCPConnectionManager(userConfig, logger, deviceId);
+ new MCPConnectionManager({
+   logger,
+   deviceId,
+   options: {
+     connectionInfo: config, // or transport hints for OIDC
+     displayName: serverMetadata.mcpServerName,
+     version: serverMetadata.version,
+   },
+ });
```

`ConnectionManagerFactoryFn` now takes `ConnectionManagerFactoryOptions` instead of `{ logger, deviceId, userConfig }`.

`ConnectionStateConnected` constructor is options-object shaped.

---

## ApiClient

```diff
- new ApiClient(options, logger, authProvider);
+ new ApiClient({
+   options: { baseUrl, userAgent },
+   logger,
+   authProvider,
+ });
```

---

## Tools

### Import paths

```diff
- import { FindTool, AggregateTool } from "mongodb-mcp-server/tools";
+ import { FindTool, AggregateTool } from "@mongodb-js/mcp-tools-mongodb";

- import { AllTools } from "mongodb-mcp-server/tools";
+ import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
+ import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
+ const tools = [...MongoDBTools, ...AtlasTools];
```

### `ToolBase` / `ToolClass`

- `ToolBase` and `ToolClass` use fewer generic parameters (`ToolBase<TSession>`, `ToolClass<TSession, TMetricsDefinitions>`).
- `ToolCategory` adds `"custom"`.
- MongoDB tools require `IMongoDBConfig` on the session config; no runtime defaults inside `MongoDBToolBase` — supply parsed config (e.g. `UserConfigSchema.parse(...)`).

### Bundled tool packages

| Package                             | Export                                                |
| ----------------------------------- | ----------------------------------------------------- |
| `@mongodb-js/mcp-tools-mongodb`     | `MongoDBTools`, `MongoDBToolBase`, connection helpers |
| `@mongodb-js/mcp-tools-atlas`       | `AtlasTools`                                          |
| `@mongodb-js/mcp-tools-atlas-local` | `AtlasLocalTools`, `createAtlasLocalClient`           |
| `@mongodb-js/mcp-tools-assistant`   | `AssistantTools`                                      |

---

## Metrics

```diff
- import { Metrics, DefaultMetrics, createDefaultMetrics } from "mongodb-mcp-server";
+ import {
+   PrometheusMetrics,
+   createDefaultMetrics,
+   type DefaultPrometheusMetricDefinitions,
+ } from "@mongodb-js/mcp-metrics";
```

Use `IMetrics<DefaultMetricDefinitions>` in server/runner types.

---

## Config overrides

```diff
- applyConfigOverrides({ baseConfig, request }); // request: RequestContext
+ applyConfigOverrides({ baseConfig, request }); // request: TransportRequestContext
```

Helpers: `getConfigMeta`, `nameToConfigKey`, `onlyStricterLogLevelOverride` from `@mongodb-js/mcp-cli`.

---

## Suggested migration workflow

1. List symbols your project imports from `mongodb-mcp-server` (v1 library usage).
2. Diff v1 vs v2 API reports (paths above) for each symbol.
3. Choose scoped packages from **Package selection by use case**.
4. Apply renames (`Server` → `CliServer`, `Telemetry` → `AtlasTelemetry`, etc.).
5. Refactor transport setup to pre-built server + `MCPHttpServer.createServerForRequest`.
6. Run `pnpm run check` (or your consumer test suite).

Reference implementation: [`packages/cli/src/createServicesFromUserConfig.ts`](packages/cli/src/createServicesFromUserConfig.ts), [`packages/cli/src/startServer.ts`](packages/cli/src/startServer.ts), [`packages/integration-tests/src/integrationHelpers.ts`](packages/integration-tests/src/integrationHelpers.ts).
