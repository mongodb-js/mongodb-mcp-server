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
registration, request-scoped configuration). It runs in the **consumer's repository**, not the
mongodb-mcp-server repo.

**`MCP_SERVER_LIBRARY.md` now documents the v3 API surface** (the scoped `@mongodb-js/mcp-*`
packages, `runMcpCli`, `CliServer`, `MCPHttpServer.createServerForRequest`, `ToolBase`/
`ToolClass`, …). Use it as the reference for the migration target; the before/after
sections in this skill and its inventory script map v1/v2 consumer code onto that surface.

> **v3 is sessionless.** The v3 server has no `Session` / `CliSession` object and no
> per-client session state anywhere. Each HTTP request (or stdio connection) gets a fresh
> **request-scoped** `CliServer` built by `createServerFromConfig`; every heavy dependency
> (connections, exports, API client, telemetry, metrics, keychain) is built once per
> process inside `SharedServerServices` and shared. Tools/resources read services off
> `this.server` (there is no `session`), and per-client identity travels on the tool
> request (`ToolExecutionContext.request.clientInfo`) rather than on a session object.

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

| Use case                    | `npm install`                                                     | Primary v3 imports                                                                                               |
| --------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Custom CLI (most v1 embeds) | `@mongodb-js/mcp-cli` + needed tool packages                      | `runMcpCli`, `createRunnerFromConfig`, `create*FromConfig`, `Resources`, `CliServer`                             |
| Host MCP over stdio         | `@mongodb-js/mcp-core`                                            | `StdioRunner`, `SessionStore`, `Keychain`, `Elicitation`, `NoopTelemetry`, `InMemoryTransport`                   |
| Host MCP over HTTP          | `@mongodb-js/mcp-http-runners` `@mongodb-js/mcp-core`             | `StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`                                                      |
| Embed server (advanced)     | cli + core + http-runners + metrics + logging + telemetry + tools | `CliServer`, `createSharedServicesFromConfig`, `createServerFromConfig`, `createRunnerFromConfig`, `startRunner` |
| Config parsing / overrides  | `@mongodb-js/mcp-cli`                                             | `UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `configRegistry`                    |
| Custom tools (any category) | `@mongodb-js/mcp-core` `@mongodb-js/mcp-types`                    | `ToolBase`, `ToolClass`, `OperationType`, `ToolCategory`                                                         |
| MongoDB tools + connections | `@mongodb-js/mcp-tools-mongodb`                                   | `FindTool`, `MongoDBToolBase`, `MCPConnectionManager`, `ErrorCodes`, `MongoDBError`                              |
| Atlas Admin API tools       | `@mongodb-js/mcp-tools-atlas` `@mongodb-js/mcp-atlas-api-client`  | `AtlasTools`, `ApiClient`, `ClientCredentialsAuthProvider`                                                       |
| Atlas Local tools           | `@mongodb-js/mcp-tools-atlas-local`                               | `AtlasLocalTools`, `createAtlasLocalClient`                                                                      |
| Assistant / knowledge tools | `@mongodb-js/mcp-tools-assistant`                                 | `AssistantTools`                                                                                                 |
| Telemetry                   | `@mongodb-js/mcp-atlas-telemetry`                                 | `AtlasTelemetry`, `EventCache`, `TelemetryConfig`                                                                |
| Logging                     | `@mongodb-js/mcp-logging`                                         | `ConsoleLogger`, `DiskLogger`, `McpLogger`                                                                       |
| Metrics                     | `@mongodb-js/mcp-metrics`                                         | `PrometheusMetrics`, `createDefaultMetrics`                                                                      |
| MCP UI resources            | `@mongodb-js/mcp-ui`                                              | `UIRegistry`                                                                                                     |
| Shared types                | `@mongodb-js/mcp-types`                                           | `TransportRequestContext`, `ITransportRunner`, `ToolServer`, `ToolServices`, `ServerMetadata`                    |

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
server first, attach transport. The simplest path is the CLI's own
`CliMcpHttpServer` + `createHttpTransportRunnerFromConfig`, which wires an
`MCPHttpServer` that builds a fresh request-scoped `CliServer` per request from
`SharedServerServices`:

```typescript
import {
  createSharedServicesFromConfig,
  createHttpTransportRunnerFromConfig,
} from "@mongodb-js/mcp-cli";

const sharedServices = await createSharedServicesFromConfig({
  config,
  serverMetadata,
  tools,
  resources,
  logger,
});
const runner = createHttpTransportRunnerFromConfig(sharedServices);
await runner.start();
```

To also apply per-request config overrides or stricter auth (e.g. enforce
`authMode: "authenticated"`), subclass `MCPHttpServer` and override
`createServerForRequest` to return a request-scoped `CliServer` built with
`createServerFromConfig`:

```diff
- class CustomRunner extends StreamableHttpRunner {
-   protected override async createServerForRequest({ request }) {
-     return this.createServer({ userConfig: sessionConfig });
-   }
- }
+ class MyMCPHttpServer extends MCPHttpServer<CliServer> {
+   protected override async createServerForRequest(
+     request: TransportRequestContext
+   ): Promise<CliServer> {
+     const config = applyConfigOverrides({ baseConfig: this.sharedServices.config, request });
+     return createServerFromConfig({ config, sharedServices: this.sharedServices, request });
+   }
+ }

+ const mcpHttpServer = new MyMCPHttpServer({
+   options: {
+     http: {
+       host: config.httpHost,
+       port: config.httpPort,
+       bodyLimit: config.httpBodyLimit,
+       headers: config.httpHeaders,
+       responseType: config.httpResponseType,
+       authMode: "authenticated", // or "unauthenticated"
+     },
+   },
+   logger,
+   metrics,
+ });
+ const runner = new StreamableHttpRunner({ logger, metrics, mcpHttpServer });
```

Note the v3 `MCPHttpServer` takes `options.http` (with the required `authMode`) and an
optional `sessionOptions` for the legacy 2025-era lifecycle — there is no
`session:` block and no `SessionStore` to build. App-level services (`keychain`,
`connectionStore`, `exportsManager`, `apiClient`, `telemetry`, …) are built once by
`createSharedServicesFromConfig` and passed in as `SharedServerServices`; the
request-scoped server holds no per-client session state (connections are scoped per
request via the request's auth identity). See
[Use Case 2](../MCP_SERVER_LIBRARY.md#use-case-2-request-scoped-configuration).

Still may `extends StreamableHttpRunner` to customize `start()`/`close()` or bundle the
wiring in a constructor — just don't override `createServerForRequest` there.

Stdio, for completeness: `new StdioRunner({ userConfig: config })` → subclass
`StdioRunner` (or use `CliStdioRunner`) and override `createServer()` (import
`@mongodb-js/mcp-core`; the constructor takes only `{ logger }`). The runner serves
through the SDK's `serveStdio` entry (protocol revision 2026-07-28 and 2025-era):
`createServer()` returns a **registered** `CliServer` (`await server.register()` before
returning `server.mcpServer`), built fresh per stdio connection.

### 3c. Config

```diff
- import { parseUserConfig, applyConfigOverrides, type UserConfig } from "mongodb-mcp-server";
+ import { parseUserConfig, applyConfigOverrides, type UserConfig } from "@mongodb-js/mcp-cli";

- applyConfigOverrides({ baseConfig, request?: RequestContext });
+ applyConfigOverrides({ baseConfig, request?: TransportRequestContext });  // type from @mongodb-js/mcp-types
```

`parseArgsWithCliOptions` → `parseUserConfig`. Config moved from the server onto the
request-scoped server: **`server.userConfig` → `server.config`** (there is no session
object — tools/resources read config off their construction-time `this.server`).
`applyConfigOverrides` applies request-level overrides to a base `UserConfig`; on HTTP
each request produces its own config via `applyConfigOverrides({ baseConfig, request })`.

## Step 4 — Migrate remaining symbols

### Renamed symbols

| v1 (old)                                                                                     | v3 (new)                                                                                                                                                                                                                                  | Package                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `Server` / `ServerOptions`                                                                   | `CliServer` / `CliServerOptions` (request-scoped)                                                                                                                                                                                         | `@mongodb-js/mcp-cli`                                      |
| `Session` / `SessionOptions`                                                                 | **removed** — the per-client session is gone. Config now lives on the request-scoped server (`server.config`); per-client identity travels on the tool request (`ToolExecutionContext.request.clientInfo`). No `CliSession` exists in v3. | —                                                          |
| `Telemetry`                                                                                  | `AtlasTelemetry`                                                                                                                                                                                                                          | `@mongodb-js/mcp-atlas-telemetry`                          |
| `BaseEvent`                                                                                  | `TelemetryBaseEvent`                                                                                                                                                                                                                      | `@mongodb-js/mcp-atlas-telemetry`                          |
| `CommonProperties`                                                                           | `TelemetryCommonProperties`                                                                                                                                                                                                               | `@mongodb-js/mcp-atlas-telemetry`                          |
| `NullLogger`                                                                                 | `NoopLogger`                                                                                                                                                                                                                              | `@mongodb-js/mcp-core`                                     |
| `RequestContext`                                                                             | `TransportRequestContext`                                                                                                                                                                                                                 | `@mongodb-js/mcp-types`                                    |
| `TransportRunnerBase`                                                                        | `ITransportRunner`                                                                                                                                                                                                                        | `@mongodb-js/mcp-types`                                    |
| `Metrics<T>` / `DefaultMetrics`                                                              | `IMetrics<T>` / `DefaultMetricDefinitions`                                                                                                                                                                                                | `@mongodb-js/mcp-types`                                    |
| `MCPHttpServerConstructorArgs`                                                               | `MCPHttpServerOptions`                                                                                                                                                                                                                    | `@mongodb-js/mcp-http-runners`                             |
| `MonitoringServerConstructorArgs`                                                            | `MonitoringServerOptions`                                                                                                                                                                                                                 | `@mongodb-js/mcp-http-runners`                             |
| `StreamableHttpTransportRunnerConfig`                                                        | `StreamableHttpRunnerOptions` + wired `MCPHttpServer`                                                                                                                                                                                     | `@mongodb-js/mcp-http-runners`                             |
| `defaultCreateApiClient`                                                                     | `createApiClientFromConfig` or construct `ApiClient`                                                                                                                                                                                      | `@mongodb-js/mcp-cli` / `@mongodb-js/mcp-atlas-api-client` |
| `defaultCreateAtlasLocalClient`                                                              | `createAtlasLocalClient`                                                                                                                                                                                                                  | `@mongodb-js/mcp-tools-atlas-local`                        |
| `defaultCreateConnectionManager` / `createMCPConnectionManager`                              | `createConnectionManagerFromConfig` or `new MCPConnectionManager({...})`                                                                                                                                                                  | `@mongodb-js/mcp-cli` / `@mongodb-js/mcp-tools-mongodb`    |
| `createDefaultMcpHttpServer` / `createDefaultMonitoringServer` / `createDefaultSessionStore` | `new MCPHttpServer(...)` / `new MonitoringServer(...)` / `new SessionStore(...)`                                                                                                                                                          | `@mongodb-js/mcp-http-runners` / `@mongodb-js/mcp-core`    |
| `createServicesFromUserConfig`                                                               | `createServerFromConfig` + `createRunnerFromConfig`                                                                                                                                                                                       | `@mongodb-js/mcp-cli`                                      |
| `parseArgsWithCliOptions`                                                                    | `parseUserConfig`                                                                                                                                                                                                                         | `@mongodb-js/mcp-cli`                                      |
| tool classes (e.g. `FindTool`)                                                               | same names, new package                                                                                                                                                                                                                   | `@mongodb-js/mcp-tools-*`                                  |

### Removed from the v1 public API — do not import

`ApiClientFactoryFn`, `BaseEvent`, `CommonProperties`, `CreateMcpHttpServerFn`,
`CreateMonitoringServerFn`, `CreateSessionConfigFn`, `CreateSessionStoreFn`, `Credentials`,
`CustomizableServerOptions`, `CustomizableSessionOptions`, `MCPHttpServerConstructorArgs`,
`MonitoringServerConfig`, `MonitoringServerConstructorArgs`, `NullLogger`,
`RequestContext`, `Server`, `ServerOptions`, `Session`, `SessionOptions`, `CliSession`,
`CliSessionOptions`, `StreamableHttpTransportRunnerConfig`, `Telemetry`,
`TransportRunnerBase`, `TransportRunnerConfig`, `UIRegistryOptions`,
`createDefaultMcpHttpServer`, `createDefaultMonitoringServer`, `createDefaultSessionStore`,
`createMCPConnectionManager`, `defaultCreateApiClient`, `defaultCreateAtlasLocalClient`,
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

Custom tool classes: `ToolBase`/`ToolClass` from `@mongodb-js/mcp-core`. There is no
`TSession` — the constructor receives `{ server, transportRequest }` and tools read
config/services off `this.server` (`ToolServer`). The `TServices` generic narrows the
app-level services a tool category reads: `MongoDBToolServer` (from
`@mongodb-js/mcp-tools-mongodb`) extends `ToolServer` with `connectionRegistry`,
`connectionErrorHandler` and `exportsManager`, and `MongoDBToolServices` narrows the
config to `IMongoDBConfig`. Use `UserConfigSchema.parse` for defaults. `execute` now
receives `(args, { request })`; per-request data (`request.headers`, `request.id`,
`request.clientInfo`, `request.inputResponses`, …) travels on the request, while the
effective config lives on `this.server.config`. `ToolCategory` gains `"custom"`.

### Sessionless HTTP serving (`MCPHttpServer`)

v3 hosts MCP over HTTP through `MCPHttpServer` (`@mongodb-js/mcp-http-runners`), which
serves both the 2026-07-28 **stateless** protocol (each request builds a fresh
request-scoped server) and the 2025-era **legacy** sessionful protocol (via an internal
`LegacyMcpHttpHandler`). Key deltas from a sessionful embed:

- **`MCPHttpServer` has no `sessionStore` option.** Its options are
  `{ options: { http }, logger, metrics, sessionOptions? }`; `sessionOptions`
  (`maxSessions`, `idleTimeoutMS`, `notificationTimeoutMS`, `evictionIdleGraceMS`)
  configure the default legacy `SessionStore`. To inject your own, override
  `createLegacyHandler` (see below).
- **`createServerForRequest` returns a server-scoped `CliServer`** (no `Session`).
  The base calls `server.register()` for you before handing the `McpServer` to the
  transport, so a subclass must not register resources/tools itself. Build the server
  with `transportRequest` so tools see the per-request headers/auth.
- **Inject HTTP middleware** by overriding `protected registerMiddlewares(): void`
  (called after body parsing + header validation, before the `/mcp` routes);
  `this.app.use(...)` your auth/rate-limiter/observability.
- **Inject a custom session store** for the legacy path: override
  `MCPHttpServer.createLegacyHandler` to pass an auth-aware or durable `ISessionStore`
  to the `LegacyMcpHttpHandler` (which requires one).

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

Full stack alternative: build app-level services once with
`createSharedServicesFromConfig`, then `createServerFromConfig({ config, sharedServices, request })`
returns a **request-scoped `CliServer` directly** (the logger is provided as input; the
heavy services come from `sharedServices`). `createRunnerFromConfig` calls
`createSharedServicesFromConfig` internally and returns only the configured transport
runner; `closeSharedServices(sharedServices)` releases app-level services on shutdown.

### Symbols that keep their names

`UserConfig`, `UserConfigSchema`, `parseUserConfig`, `applyConfigOverrides`, `ApiClient`,
`ConnectionManager`, `MCPConnectionManager`, `connectionErrorHandler`, `ErrorCodes`,
`MongoDBError`, `EventCache`, `ExportsManager`, `DeviceId`, `UIRegistry`,
`JSON_RPC_ERROR_CODE_*`, `packageInfo` (new in v3).

Names that survive but changed shape: `Keychain` (now `IRedactor`-compatible —
`redact(value)` replaces the removed `allSecrets` field), `Elicitation` (now
multi-round-trip `confirmationRequired`/`readConfirmation`/`inputRequired`/`readInput`
instead of `requestConfirmation`/`requestInput`), and `SessionStore` (**deprecated** —
only the 2025-era legacy transport still uses it).

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
3. **No session object exists** — v3 is sessionless: there is nothing named `Session`,
   `CliSession`, `ISession` or `IToolSession`. Config lives on the request-scoped server
   (`this.server.config`); per-client identity travels on the tool request
   (`ToolExecutionContext.request.clientInfo`). Grep for `session.` after migrating.
4. **Runner constructor changed** — passing `userConfig` to a runner is a v1-only API and
   will not typecheck.
5. **Tool generics changed** — old three-type-param `ToolBase` code must drop to
   `ToolBase<ToolServer>` (constructor `{ server, transportRequest }`) and source config
   from `this.server.config`, not a session. MongoDB tools should target
   `MongoDBToolServer`/`MongoDBToolServices`.
6. **Type-only imports** — the v3 packages enforce `import type { … }` for types
   (`erasableSyntaxOnly`); fix any value/type mixed imports flagged by the compiler.
