---
name: mongodb-mcp-v3-migration
description: >
  Migrates external consumer code from the mongodb-mcp-server v1/v2 single-package API
  to the v3 scoped-package structure. In v3, mongodb-mcp-server is a binary-only package
  (npx / MCPB); library embedding uses @mongodb-js/mcp-cli, @mongodb-js/mcp-core,
  @mongodb-js/mcp-http-runners, @mongodb-js/mcp-tools-*, and the other @mongodb-js/mcp-*
  packages. Use when asked to migrate a project embedding or extending mongodb-mcp-server
  ("update my code to v3", "fix imports after the v3 release", "migrate my custom
  server/tools to the new packages"), or by external users following the v3 migration guide.
---

# MongoDB MCP Server v1 → v3 migration

This skill migrates **consumer code**: projects that embed, customize, or extend
`mongodb-mcp-server` as a library (custom CLIs, HTTP hosts, custom tools, selective tool
registration, per-session config). It runs in the **consumer's repository**, not the
mongodb-mcp-server repo.

**`MCP_SERVER_LIBRARY.md` now documents the v3 API surface** (the scoped `@mongodb-js/mcp-*`
packages, `runMcpCli`, `CliServer`/`Session`, `MCPHttpServer.createServerForRequest`,
`ToolBase`/`ToolClass`, …). Use it as the reference for the migration target; the
before/after sections in this skill and its inventory script map v1/v2 consumer code onto
that surface.

## The core rule

**`mongodb-mcp-server` is not a library in v3.**

- End users: `npx mongodb-mcp-server` or the MCPB binary only.
- **Do not** `npm install mongodb-mcp-server` and `import { … } from "mongodb-mcp-server"` in application code.
- **Do not** use the legacy `mongodb-mcp-server/tools` or `mongodb-mcp-server/web` entry points.

Embed via the scoped packages instead: **`@mongodb-js/mcp-cli`** (custom CLI), **`@mongodb-js/mcp-*`** for everything else.

## Step 1 — Inventory consumer code

```bash
# repo root of the consumer project; resolves skill-relative scripts against this skill's dir
scripts/inventory-consumer-code.sh .
```

The script lists every file that imports `mongodb-mcp-server`, shows the matched import
lines, and classifies each imported symbol to its v3 package. Anything reported as
`unrecognized — manual review` is a symbol the table doesn't know: look it up in the
v3 migration guide and the package's API report before deciding.

Then get the full picture of every usage site:

```bash
rg -n 'mongodb-mcp-server|from "mongodb-mcp-server"|require\("mongodb-mcp-server"' --glob '!node_modules' --glob '!dist' .
```

## Step 2 — Classify the use case

Pick the row(s) that match what the consumer does; install those packages (v3):

| Use case                    | `npm install`                                                     | Primary v3 imports                                                                                 |
| --------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Custom CLI (most v1 embeds) | `@mongodb-js/mcp-cli` + needed tool packages                      | `runMcpCli`, `createRunnerFromConfig`, `create*FromConfig`, `Resources`, `CliServer`, `CliSession` |
| Host MCP over stdio         | `@mongodb-js/mcp-core`                                            | `StdioRunner`, `SessionStore`, `Keychain`, `Elicitation`, `NoopTelemetry`, `InMemoryTransport`     |
| Host MCP over HTTP          | `@mongodb-js/mcp-http-runners` `@mongodb-js/mcp-core`             | `StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`                                        |
| Embed server (advanced)     | cli + core + http-runners + metrics + logging + telemetry + tools | `CliServer`, `CliSession`, `createServerFromConfig`, `createRunnerFromConfig`, `startRunner`       |
| Config parsing / overrides  | `@mongodb-js/mcp-cli`                                             | `UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `configRegistry`      |
| Custom tools (any category) | `@mongodb-js/mcp-core` `@mongodb-js/mcp-types`                    | `ToolBase`, `ToolClass`, `OperationType`, `ToolCategory`                                           |
| MongoDB tools + connections | `@mongodb-js/mcp-tools-mongodb`                                   | `FindTool`, `MongoDBToolBase`, `MCPConnectionManager`, `ErrorCodes`, `MongoDBError`                |
| Atlas Admin API tools       | `@mongodb-js/mcp-tools-atlas` `@mongodb-js/mcp-atlas-api-client`  | `AtlasTools`, `ApiClient`, `ClientCredentialsAuthProvider`                                         |
| Atlas Local tools           | `@mongodb-js/mcp-tools-atlas-local`                               | `AtlasLocalTools`, `createAtlasLocalClient`                                                        |
| Assistant / knowledge tools | `@mongodb-js/mcp-tools-assistant`                                 | `AssistantTools`                                                                                   |
| Telemetry                   | `@mongodb-js/mcp-atlas-telemetry`                                 | `AtlasTelemetry`, `EventCache`, `TelemetryConfig`                                                  |
| Logging                     | `@mongodb-js/mcp-logging`                                         | `ConsoleLogger`, `DiskLogger`, `McpLogger`                                                         |
| Metrics                     | `@mongodb-js/mcp-metrics`                                         | `PrometheusMetrics`, `createDefaultMetrics`                                                        |
| MCP UI resources            | `@mongodb-js/mcp-ui`                                              | `UIRegistry`                                                                                       |
| Shared types                | `@mongodb-js/mcp-types`                                           | `TransportRequestContext`, `ITransportRunner`, `ISession`, `ServerMetadata`                        |

## Step 3 — Install and migrate the big three use cases

### 3a. Custom CLI → `runMcpCli`

Most v1 embeds become one `runMcpCli` call (same flow as the official v3 binary):
parse config → handlers → create server → start stdio/HTTP.

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

/** Ideally read/generated from package.json */
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

Escalation ladder if they need more control: `createServerFromConfig` / `createRunnerFromConfig` + `startRunner`
(both `@mongodb-js/mcp-cli`) → `CliServer` + `@mongodb-js/mcp-http-runners` for per-request
HTTP.

### 3b. HTTP host → `MCPHttpServer` + `StreamableHttpRunner`

Per-request server creation **moved off the runner**. In v1,
`createServerForRequest` lived on `StreamableHttpRunner`; in v3 it lives on
**`MCPHttpServer`**. Runners no longer accept `userConfig` or build the server — build the
server first, attach transport:

```diff
- class CustomRunner extends StreamableHttpRunner {
-   protected override async createServerForRequest({ request }) {
-     return this.createServer({ userConfig: sessionConfig });
-   }
- }
+ class MyMCPHttpServer extends MCPHttpServer {
+   protected override async createServerForRequest(
+     request: TransportRequestContext
+   ): Promise<CliServer> {
+     return new CliServer({ /* per request */ });
+   }
+ }

+ const sessionStore = new SessionStore({
+   options: {
+     idleTimeoutMS: config.idleTimeoutMs,
+     notificationTimeoutMS: config.notificationTimeoutMs,
+   },
+   logger,
+   metrics,
+ });
+ const mcpHttpServer = new MyMCPHttpServer({
+   options: {
+     http: { host: config.httpHost, port: config.httpPort, bodyLimit: config.httpBodyLimit, headers: config.httpHeaders, responseType: config.httpResponseType },
+     session: { idleTimeoutMs: config.idleTimeoutMs, notificationTimeoutMs: config.notificationTimeoutMs, externallyManagedSessions: config.externallyManagedSessions },
+   },
+   logger,
+   metrics,
+   sessionStore,
+ });
+ const runner = new StreamableHttpRunner({ logger, metrics, mcpHttpServer, sessionStore });
```

Still may `extends StreamableHttpRunner` to customize `start()`/`close()` or bundle the
wiring in a constructor — just don't override `createServerForRequest` there.

Stdio, for completeness: `new StdioRunner({ userConfig: config })` → subclass
`StdioRunner` and override `createServer()` (import `@mongodb-js/mcp-core`;
the constructor takes only `{ logger }`). The runner serves through the SDK's
`serveStdio` entry (protocol revision 2026-07-28 and 2025-era): `createServer()`
is a method returning a **registered** `McpServer` (`await server.register()`
before returning `server.mcpServer`), built fresh per stdio connection.

### 3c. Config

```diff
- import { parseUserConfig, applyConfigOverrides, type UserConfig } from "mongodb-mcp-server";
+ import { parseUserConfig, applyConfigOverrides, type UserConfig } from "@mongodb-js/mcp-cli";

- applyConfigOverrides({ baseConfig, request?: RequestContext });
+ applyConfigOverrides({ baseConfig, request?: TransportRequestContext });  // type from @mongodb-js/mcp-types
```

`parseArgsWithCliOptions` → `parseUserConfig`. Config moved from the server onto the
session: **`session.userConfig` → `session.config`**.

## Step 4 — Migrate remaining symbols

### Renamed symbols

| v1 (old)                                                                                     | v3 (new)                                                                         | Package                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Server` / `ServerOptions`                                                                   | `CliServer` / `CliServerOptions`                                                 | `@mongodb-js/mcp-cli`                                      |
| `Session` / `SessionOptions`                                                                 | `CliSession` / `CliSessionOptions`                                               | `@mongodb-js/mcp-cli`                                      |
| `Telemetry`                                                                                  | `AtlasTelemetry`                                                                 | `@mongodb-js/mcp-atlas-telemetry`                          |
| `BaseEvent`                                                                                  | `TelemetryBaseEvent`                                                             | `@mongodb-js/mcp-atlas-telemetry`                          |
| `CommonProperties`                                                                           | `TelemetryCommonProperties`                                                      | `@mongodb-js/mcp-atlas-telemetry`                          |
| `NullLogger`                                                                                 | `NoopLogger`                                                                     | `@mongodb-js/mcp-core`                                     |
| `RequestContext`                                                                             | `TransportRequestContext`                                                        | `@mongodb-js/mcp-types`                                    |
| `TransportRunnerBase`                                                                        | `ITransportRunner`                                                               | `@mongodb-js/mcp-types`                                    |
| `Metrics<T>` / `DefaultMetrics`                                                              | `IMetrics<T>` / `DefaultMetricDefinitions`                                       | `@mongodb-js/mcp-types`                                    |
| `MCPHttpServerConstructorArgs`                                                               | `MCPHttpServerOptions`                                                           | `@mongodb-js/mcp-http-runners`                             |
| `MonitoringServerConstructorArgs`                                                            | `MonitoringServerOptions`                                                        | `@mongodb-js/mcp-http-runners`                             |
| `StreamableHttpTransportRunnerConfig`                                                        | `StreamableHttpRunnerOptions` + wired `MCPHttpServer`                            | `@mongodb-js/mcp-http-runners`                             |
| `defaultCreateApiClient`                                                                     | `createApiClientFromConfig` or construct `ApiClient`                             | `@mongodb-js/mcp-cli` / `@mongodb-js/mcp-atlas-api-client` |
| `defaultCreateAtlasLocalClient`                                                              | `createAtlasLocalClient`                                                         | `@mongodb-js/mcp-tools-atlas-local`                        |
| `defaultCreateConnectionManager` / `createMCPConnectionManager`                              | `createConnectionManagerFromConfig` or `new MCPConnectionManager({...})`         | `@mongodb-js/mcp-cli` / `@mongodb-js/mcp-tools-mongodb`    |
| `createDefaultMcpHttpServer` / `createDefaultMonitoringServer` / `createDefaultSessionStore` | `new MCPHttpServer(...)` / `new MonitoringServer(...)` / `new SessionStore(...)` | `@mongodb-js/mcp-http-runners` / `@mongodb-js/mcp-core`    |
| `createServicesFromUserConfig`                                                               | `createServerFromConfig` + `createRunnerFromConfig`                              | `@mongodb-js/mcp-cli`                                      |
| `parseArgsWithCliOptions`                                                                    | `parseUserConfig`                                                                | `@mongodb-js/mcp-cli`                                      |
| tool classes (e.g. `FindTool`)                                                               | same names, new package                                                          | `@mongodb-js/mcp-tools-*`                                  |

### Removed from the v1 public API — do not import

`ApiClientFactoryFn`, `BaseEvent`, `CommonProperties`, `CreateMcpHttpServerFn`,
`CreateMonitoringServerFn`, `CreateSessionConfigFn`, `CreateSessionStoreFn`, `Credentials`,
`CustomizableServerOptions`, `CustomizableSessionOptions`, `MCPHttpServerConstructorArgs`,
`MonitoringServerConfig`, `MonitoringServerConstructorArgs`, `NullLogger`,
`RequestContext`, `Server`, `ServerOptions`, `Session`, `SessionOptions`,
`StreamableHttpTransportRunnerConfig`, `Telemetry`, `TransportRunnerBase`,
`TransportRunnerConfig`, `UIRegistryOptions`, `createDefaultMcpHttpServer`,
`createDefaultMonitoringServer`, `createDefaultSessionStore`, `createMCPConnectionManager`,
`defaultCreateApiClient`, `defaultCreateAtlasLocalClient`,
`defaultCreateConnectionManager`, `parseArgsWithCliOptions`

Handle each with the rename table above or the replacements below.

### Constructor shape changes (same concepts, different args)

```diff
- new LoggerBase(keychain);            // also ConsoleLogger, DiskLogger
+ new LoggerBase({ keychain });

- new CompositeLogger(a, b);
+ new CompositeLogger({ loggers: [a, b], keychain });

- new ApiClient(options, logger, authProvider);
+ new ApiClient({ options: { baseUrl, userAgent }, logger, authProvider });

- new MCPConnectionManager(userConfig, logger, deviceId);
+ new MCPConnectionManager({ logger, deviceId, options: { connectionInfo: config, displayName, version } });

- new ConnectionStateConnected(sp, info, atlas);
+ new ConnectionStateConnected({ serviceProvider: sp, connectionStringInfo: info, connectedAtlasCluster: atlas });
```

### Telemetry

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

`getCommonProperties` callback → subclass `AtlasTelemetry` and override
`getCommonProperties()`, calling `super`. `keychain` and `serverMetadata` are now
**required**. Tests use `NoopTelemetry` from `@mongodb-js/mcp-core`.

### Tools and custom tools

```diff
- import { FindTool, MongoDBToolBase } from "mongodb-mcp-server/tools";
+ import { FindTool, MongoDBToolBase } from "@mongodb-js/mcp-tools-mongodb";

- import { AllTools } from "mongodb-mcp-server/tools";
+ import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
+ import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
+ const tools = [...MongoDBTools, ...AtlasTools];
```

Bundles: `MongoDBTools` (`@mongodb-js/mcp-tools-mongodb`), `AtlasTools`
(`@mongodb-js/mcp-tools-atlas`), `AtlasLocalTools` (`@mongodb-js/mcp-tools-atlas-local`),
`AssistantTools` (`@mongodb-js/mcp-tools-assistant`).

Custom tool classes: `ToolBase`/`ToolClass` from `@mongodb-js/mcp-core` with fewer
generics (`ToolBase<TSession>`; the config type no longer comes from the tool). MongoDB
tools need the full `IMongoDBConfig` on the session config — use `UserConfigSchema.parse`
for defaults. `ToolCategory` gains `"custom"`.

### Customizing via `create*FromConfig` factories

When overriding only part of the stack, use individual factories from `@mongodb-js/mcp-cli`:

```typescript
const keychain = Keychain.root; // @mongodb-js/mcp-core
const logger = await createLoggerFromConfig({ config, keychain });
const apiClient = createApiClientFromConfig({ config, serverMetadata, logger });
```

| v1 helper                       | v3 replacement                                                    |
| ------------------------------- | ----------------------------------------------------------------- |
| `defaultCreateApiClient`        | `createApiClientFromConfig` or `new ApiClient(...)`               |
| `createDefaultMonitoringServer` | `createMonitoringServerFromConfig` or `new MonitoringServer(...)` |
| ad-hoc logger from config       | `createLoggerFromConfig`                                          |

Full stack alternative: `createServerFromConfig` returns
`{ server, config, metrics, monitoringServer }` (the logger is provided as input;
`monitoringServer` is undefined unless `monitoringServerHost` + `monitoringServerPort` are
set); `createRunnerFromConfig` calls it internally and returns only the configured transport
runner.

### Symbols that keep their names

`UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `Keychain`,
`Elicitation`, `ApiClient`, `ConnectionManager`, `MCPConnectionManager`,
`connectionErrorHandler`, `ErrorCodes`, `MongoDBError`, `EventCache`, `ExportsManager`,
`DeviceId`, `UIRegistry`, `SessionStore`, `JSON_RPC_ERROR_CODE_*`, `packageInfo` (new in v3).

## Step 5 — Verify

1. Remove the old dependency: `npm uninstall mongodb-mcp-server` (keep it only if the app
   shells out to the binary).
2. Typecheck the whole project: `npx tsc --noEmit` (or the project's build command).
3. Runtime smoke test: run the custom CLI / host and exercise one tool + telemetry.
4. If the consumer had v1 pattern-guides (`MCP_SERVER_LIBRARY.md` examples), diff usage
   against the v3 migration guide in the mongodb-mcp-server repo.

## Working with subagents (larger migrations)

- **Inventory triage**: after Step 1, hand one file (or one module cluster) per subagent:
  _"Migrate this file's mongodb-mcp-server imports to v3 scoped packages using the
  mapping in the mongodb-mcp-v3-migration skill. Produce a diff."_ Worktree note: if the
  consumer's repo is a plain working tree, subagents must only analyze/draft — the main
  agent applies edits sequentially. For parallel _editing_, give each subagent its own
  worktree (the agent tool's `worktree_path`) and merge/cherry-pick their commits.
- **Symbol lookup**: an `Explore` agent can map any symbol not in the tables by reading
  the relevant `@mongodb-js/mcp-*` package's API report in the installed node_modules.
- **Final check**: a subagent re-runs `tsc --noEmit` and greps for any lingering
  `mongodb-mcp-server` imports.

## Pitfalls

1. **`serverMetadata` is required** on `CliServerOptions` and `AtlasTelemetry.create` — v1
   code never passed it; use `packageInfo` from `@mongodb-js/mcp-core` or build it from
   the consumer's package.json.
2. **`mongodb-mcp-server/tools` and `/web` don't exist in v3** — any deep import breaks;
   use the scoped packages.
3. **`session.userConfig` → `session.config`** — silently reading `userConfig` compiles
   fine against dynamic objects; grep after migrating.
4. **Runner constructor changed** — passing `userConfig` to a runner is a v1-only API and
   will not typecheck.
5. **Tool generics changed** — old three-type-param `ToolBase` code must drop to
   `ToolBase<TSession>` and source config from the session.
6. **Type-only imports** — the v3 packages enforce `import type { … }` for types
   (`erasableSyntaxOnly`); fix any value/type mixed imports flagged by the compiler.
