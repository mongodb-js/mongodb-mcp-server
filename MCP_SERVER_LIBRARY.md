# Developer's Guide to Embedding and Extending the MongoDB MCP Server

This guide explains how to embed and extend the MongoDB MCP Server as a library to customize its core functionality and behavior for your specific use cases. It documents the **v3** API: the monorepo of scoped `@mongodb-js/mcp-*` packages.

> **Migrating from the pre-v3 single-package API?** The `mongodb-mcp-server` package is **not** a library in v3 — see the [v1 → v3 migration guide](skills/mongodb-mcp-v3-migration/SKILL.md) (in the repository) for how to update consumer code.

## 📚 Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Use Cases](#use-cases)
  - [Use Case 1: Override Server Configuration](#use-case-1-override-server-configuration)
  - [Use Case 2: Request-Scoped Configuration](#use-case-2-request-scoped-configuration)
  - [Use Case 3: Adding Custom Tools](#use-case-3-adding-custom-tools)
  - [Use Case 4: Selective Tool Registration](#use-case-4-selective-tool-registration)
- [API Reference](#api-reference)
- [Advanced Topics](#advanced-topics)
- [Examples](#examples)

## Overview

In v3 the MongoDB MCP Server is a **monorepo of scoped packages** under the `@mongodb-js/mcp-*` naming. The `mongodb-mcp-server` package itself is now a **binary-only** distribution (`npx mongodb-mcp-server` / the MCPB bundle) — it is **not** an importable library.

To embed or extend the server, depend on the scoped packages instead. The library exports provide full control over:

- Server configuration and initialization — `runMcpCli`, `createRunnerFromConfig`, `createSharedServicesFromConfig` + `createServerFromConfig`, `startRunner`
- Request-scoped server creation hooks — `MCPHttpServer.createServerForRequest` (a fresh `CliServer` per HTTP request; app-level services are shared)
- Tool registration — `ToolBase` / `ToolClass` tool classes and `ToolRegistry` arrays
- Connection management and connection error handling — `MCPConnectionManager`, `connectionErrorHandler`

> **v3 is sessionless.** There is no `Session` / `CliSession` object and no per-client
> session state anywhere. Each HTTP request (or stdio connection) is served by a fresh
> **request-scoped** `CliServer`; every heavy dependency (connections, exports, API client,
> telemetry, metrics, keychain) is built once per process and shared inside
> `SharedServerServices`. Tools and resources read services off `this.server` and derive
> per-request data (including client identity) from the tool request — they never hold a
> session.

## Installation

Install only the scoped packages your embedding needs (see the use cases below):

```bash
# Custom CLI (most common embedding)
npm install @mongodb-js/mcp-cli @mongodb-js/mcp-tools-mongodb @mongodb-js/mcp-tools-atlas

# Custom tools
npm install @mongodb-js/mcp-core @mongodb-js/mcp-types

# HTTP host
npm install @mongodb-js/mcp-cli @mongodb-js/mcp-core @mongodb-js/mcp-http-runners
```

All packages are available as ES modules. The server targets Node.js `>= 24`.

## Core Concepts

### The entry points

| Package                            | Role                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mongodb-js/mcp-cli`              | **Primary entry point.** Custom CLI (`runMcpCli`), the request-scoped server class (`CliServer`), config (`parseUserConfig`, `UserConfigSchema`, `configRegistry`, `applyConfigOverrides`), `createSharedServicesFromConfig` + `createServerFromConfig` + `createRunnerFromConfig` + `createHttpTransportRunnerFromConfig`, `Resources`, CLI handlers |
| `@mongodb-js/mcp-core`             | Transports (`StdioRunner`, `InMemoryTransport`), tool base classes (`ToolBase`, `ToolClass`) + `toToolExecutionContext`, `Keychain`/`IRedactor`, `Elicitation`, `NoopLogger`, `NoopTelemetry`, deprecated `SessionStore` (2025-era legacy)                                                                                                            |
| `@mongodb-js/mcp-http-runners`     | HTTP transport (`StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`)                                                                                                                                                                                                                                                                          |
| `@mongodb-js/mcp-types`            | Shared types (`ServerMetadata`, `TransportRequestContext`, `ToolCategory`, `OperationType`, `UserConfig`, …)                                                                                                                                                                                                                                          |
| `@mongodb-js/mcp-tools-*`          | Tool bundles: `@mongodb-js/mcp-tools-mongodb`, `-atlas`, `-atlas-local`, `-assistant`                                                                                                                                                                                                                                                                 |
| `@mongodb-js/mcp-atlas-api-client` | Atlas Admin API client (`ApiClient`, `ClientCredentialsAuthProvider`)                                                                                                                                                                                                                                                                                 |
| `@mongodb-js/mcp-atlas-telemetry`  | Telemetry pipeline (`AtlasTelemetry`)                                                                                                                                                                                                                                                                                                                 |
| `@mongodb-js/mcp-logging`          | Loggers (`ConsoleLogger`, `DiskLogger`, `McpLogger`)                                                                                                                                                                                                                                                                                                  |
| `@mongodb-js/mcp-metrics`          | Metrics (`PrometheusMetrics`, `createDefaultMetrics`)                                                                                                                                                                                                                                                                                                 |
| `@mongodb-js/mcp-ui`               | MCP UI registry (`UIRegistry`)                                                                                                                                                                                                                                                                                                                        |

### Customizing Server Behavior

There are three main approaches:

1. **`runMcpCli` (recommended for CLIs)**: one call that parses config, runs handlers, creates the server and infrastructure, and starts stdio or HTTP transport — the same flow the official binary uses.
2. **`createSharedServicesFromConfig` + `createRunnerFromConfig` + `startRunner`**: split the same flow so you can replace individual dependencies (logger, API client, telemetry, monitoring server) via `create*FromConfig` factories, or create just the server (`createServerFromConfig`) and wire a custom runner.
   - `createSharedServicesFromConfig({ config, serverMetadata, tools, resources, logger })` builds the app-level infrastructure shared by every request-scoped server (`metrics`, `monitoringServer`, `keychain`, `deviceId`, `connectionStore`, `connectionRegistry`, `apiClient`, `exportsManager`, `telemetry`, `atlasLocalClient`, `config`, `tools`, `resources`).
   - `createServerFromConfig({ config, sharedServices, request })` builds one **request-scoped** `CliServer` from a resolved config. `request` (an optional `TransportRequestContext`) is present for HTTP — the server then gets an isolated, client-scoped connection registry view and carries `transportRequest` through to tool/resource constructors. It returns `CliServer` directly.
   - `createRunnerFromConfig` calls `createSharedServicesFromConfig` internally and returns only the configured transport runner (`CliStdioRunner`/`StdioRunner` for stdio, `StreamableHttpRunner` for HTTP). `createHttpTransportRunnerFromConfig(sharedServices)` wires HTTP with the CLI's `CliMcpHttpServer`.
   - `startRunner({ transportRunner, logger, onExit })` starts the runner and manages the server lifecycle (signal handlers, graceful shutdown).
3. **Override `MCPHttpServer.createServerForRequest`**: when hosting over HTTP and you need per-request customization, subclass `MCPHttpServer` and override `createServerForRequest(request: TransportRequestContext): Promise<TServer>` (return a request-scoped `CliServer` via `createServerFromConfig`). In v3 this hook lives on `MCPHttpServer`, **not** on `StreamableHttpRunner`.

### Server metadata

`CliServer` and the telemetry pipeline require a `ServerMetadata` value — the product name/version reported to clients and used for telemetry and driver `appName`:

```typescript
import type { ServerMetadata } from "@mongodb-js/mcp-types";

const serverMetadata: ServerMetadata = {
  mcpServerName: "my-product-mcp",
  version: "1.0.0",
  engines: { node: process.version },
};
```

Prefer reading `version`/`name` from your `package.json` at build time when possible.

### Architecture

The MongoDB MCP Server library follows a modular architecture:

- **Transport runners**: `CliStdioRunner`/`StdioRunner` (stdio) and `StreamableHttpRunner` (HTTP) manage the MCP transport layer. Runners attach a pre-built server — they no longer build one for you.
- **`CliServer`**: the request-scoped server that wraps the `McpServer` and registers tools, resources and capabilities. A fresh instance is built per HTTP request (or stdio connection); it holds the effective config and a client-scoped connection registry view. There is **no** session object — `CliServer` is the whole per-request composition.
- **`SharedServerServices`** (from `createSharedServicesFromConfig`): the app-level services built once per process and shared by every request-scoped server (metrics, keychain, device id, connection store/registry, API client, exports manager, telemetry, Atlas Local client, monitoring server). App-level services deliberately carry no per-client state.
- **`ToolServer` / `ToolServices`**: the service surface a tool reads from its construction-time `this.server` (`config`, `logger`, `keychain`, `telemetry`, `elicitation`, `metrics`, `uiRegistry`, `mcpServer`, `tools`, `isToolCategoryAvailable`). Category services (e.g. `MongoDBToolServices` adds `connectionRegistry`/`connectionErrorHandler`/`exportsManager`) travel in the `TServices` generic.
- **Tools**: individual capabilities exposed to the MCP client, implemented as `ToolBase` subclasses and grouped into bundle arrays (`MongoDBTools`, `AtlasTools`, …).
- **Configuration**: `UserConfig` parsed via `parseUserConfig`/`UserConfigSchema`, with request-level override mechanisms (`applyConfigOverrides`, `configRegistry`). Each request-scoped server carries its effective config on `server.config`.

## Use Cases

### Use Case 1: Override Server Configuration

Configure the MCP server with custom settings, such as HTTP headers for authentication before serving an MCP client, or replace parts of the default infrastructure.

#### Example: Setting HTTP Headers for Authentication

```typescript
import {
  createLoggerFromConfig,
  createRunnerFromConfig,
  startRunner,
  parseUserConfig,
} from "@mongodb-js/mcp-cli";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { Resources } from "@mongodb-js/mcp-cli";
import { Keychain } from "@mongodb-js/mcp-core";
import type { ServerMetadata } from "@mongodb-js/mcp-types";

const { parsed: config } = parseUserConfig({
  args: process.argv.slice(2),
});

const serverMetadata: ServerMetadata = {
  mcpServerName: "my-product-mcp",
  version: "1.0.0",
  engines: { node: process.version },
};

const logger = await createLoggerFromConfig({
  config,
  keychain: Keychain.root,
});
const transportRunner = await createRunnerFromConfig({
  config: {
    ...config,
    httpHeaders: {
      "x-api-key": "your-secret-api-key",
    },
  },
  serverMetadata,
  tools: [...MongoDBTools],
  resources: Resources,
  logger,
});

await startRunner({
  transportRunner,
  logger,
  onExit: (code) => process.exit(code),
});
```

Clients connecting to this server must include the specified headers in their requests, otherwise their initialization request is declined.

#### Example: Replacing Infrastructure Pieces

Use individual `create*FromConfig` factories to swap dependencies:

```typescript
import {
  createLoggerFromConfig,
  createApiClientFromConfig,
} from "@mongodb-js/mcp-cli";
import { Keychain } from "@mongodb-js/mcp-core";

const keychain = Keychain.root;
const logger = await createLoggerFromConfig({ config, keychain });
const apiClient = createApiClientFromConfig({ config, serverMetadata, logger });
```

Available factories: `createLoggerFromConfig`, `createApiClientFromConfig`, `createExportsManagerFromConfig`, `createTelemetryFromConfig`, `createMonitoringServerFromConfig`.

### Use Case 2: Request-Scoped Configuration

Customize each **request-scoped server** — enabling user-specific permissions and settings based on request headers, query parameters, or authentication context — by subclassing **`MCPHttpServer`** and overriding `createServerForRequest(request: TransportRequestContext)` to build a `CliServer` per request from app-level `SharedServerServices`.

> The v1 pattern of overriding `createServerForRequest` on `StreamableHttpRunner` is **removed** in v3. Runners no longer create servers, and there is no `Session` object to customize — the per-request `CliServer` (built by `createServerFromConfig`) is the customization point.

#### Example: User-Based Tool Permissions (HTTP)

```typescript
import {
  MCPHttpServer,
  StreamableHttpRunner,
} from "@mongodb-js/mcp-http-runners";
import {
  parseUserConfig,
  createLoggerFromConfig,
  createSharedServicesFromConfig,
  createServerFromConfig,
  Resources,
  type CliServer,
  type SharedServerServices,
} from "@mongodb-js/mcp-cli";
import { Keychain } from "@mongodb-js/mcp-core";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import type {
  TransportRequestContext,
  ServerMetadata,
} from "@mongodb-js/mcp-types";

interface UserPermissions {
  role: "admin" | "developer" | "analyst";
  allowedOperations: ("read" | "metadata" | "create" | "update" | "delete")[];
  maxDocuments: number;
}

async function getUserPermissions(userId: string): Promise<UserPermissions> {
  // Replace with your auth logic
  return {
    role: "analyst",
    allowedOperations: ["read", "metadata"],
    maxDocuments: 100,
  };
}

const serverMetadata: ServerMetadata = {
  mcpServerName: "my-product-mcp",
  version: "1.0.0",
  engines: { node: process.version },
};

// App-level services, built once per process and shared by every server
const { parsed: baseConfig } = parseUserConfig({ args: process.argv.slice(2) });
const keychain = Keychain.root;
const logger = await createLoggerFromConfig({ config: baseConfig, keychain });
const sharedServices: SharedServerServices =
  await createSharedServicesFromConfig({
    config: baseConfig,
    serverMetadata,
    tools: MongoDBTools,
    resources: Resources,
    logger,
  });

// A request-scoped server per HTTP request: every heavy service comes from
// sharedServices; only the config, the connection registry view and the
// request-scoped McpServer/Elicitation/CliServer are created fresh per request.
class PermissionsMCPHttpServer extends MCPHttpServer<CliServer> {
  private readonly sharedServices: SharedServerServices;

  constructor(sharedServices: SharedServerServices) {
    super({
      options: {
        http: {
          host: baseConfig.httpHost,
          port: baseConfig.httpPort,
          bodyLimit: baseConfig.httpBodyLimit,
          headers: baseConfig.httpHeaders,
          responseType: baseConfig.httpResponseType,
          // Every deployment's auth posture is explicit. "authenticated"
          // requires a verified identity per request (injected by the host);
          // "unauthenticated" carries whatever the host provides.
          authMode: "unauthenticated",
        },
      },
      logger,
      metrics: sharedServices.metrics,
    });
    this.sharedServices = sharedServices;
  }

  protected override async createServerForRequest(
    request: TransportRequestContext
  ): Promise<CliServer> {
    const userId = request?.headers?.["x-user-id"];
    if (typeof userId !== "string") {
      throw new Error("User authentication required: x-user-id header missing");
    }

    const permissions = await getUserPermissions(userId);
    const allOperations = [
      "read",
      "metadata",
      "create",
      "update",
      "delete",
      "connect",
    ];
    const disabledTools = allOperations.filter(
      (op) => !permissions.allowedOperations.includes(op)
    );

    // The effective (possibly request-overridden) config for this request. The
    // server gets an isolated, client-scoped connection registry view derived
    // from the request (auth clientId or the x-mcp-client-name header).
    return createServerFromConfig({
      config: {
        ...baseConfig,
        disabledTools,
        readOnly: permissions.role === "analyst",
        maxDocumentsPerQuery: permissions.maxDocuments,
      },
      sharedServices: this.sharedServices,
      request,
    });
  }
}

const mcpHttpServer = new PermissionsMCPHttpServer(sharedServices);
const runner = new StreamableHttpRunner({
  logger,
  mcpHttpServer,
  monitoringServer: sharedServices.monitoringServer,
});
await runner.start();
```

> **Note:** `MongoDBTools`, `MCPConnectionStore`, `DeviceId`, and `ConnectionRegistry` come from `@mongodb-js/mcp-tools-mongodb` (see [Connection management](#connection-management)); a real embedding typically wires `createSharedServicesFromConfig` once (as above) and builds only the request-scoped `CliServer` per request via `createServerFromConfig`. MongoDB connection state deliberately lives at the app level (`connectionStore`/`connectionRegistry`), not in any session — tools address connections by `connectionId`, and per-request `createServerFromConfig` scopes that registry per request (stable scope for identified clients, ephemeral otherwise).

### Use Case 3: Adding Custom Tools

Implement custom tools by extending `ToolBase` from `@mongodb-js/mcp-core`:

```typescript
import {
  ToolBase,
  type ToolClass,
  type ToolCategory,
  type OperationType,
} from "@mongodb-js/mcp-core";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";
import { z } from "zod";

class MyCustomTool extends ToolBase {
  static toolName = "my-custom-tool";
  static category: ToolCategory = "custom";
  static operationType: OperationType = "read";

  public description = "My custom tool description";
  public argsShape = {
    query: z.string().describe("The query parameter"),
  };

  protected async execute(args, { request }: ToolExecutionContext) {
    // Tool implementation — arguments are inferred from argsShape. The effective
    // config is read off `this.server.config`; per-request data (request.id,
    // request.headers, request.clientInfo, ...) arrives on `request`.
    return {
      content: [{ type: "text", text: "Result" }],
      structuredContent: { query: args.query },
    };
  }

  protected resolveTelemetryMetadata() {
    return {};
  }
}
```

Register the class by including it in the `tools` array (a `ToolRegistry`) passed to `runMcpCli`, `createRunnerFromConfig`, `createServerFromConfig`, or `CliServer`: `const tools: ToolRegistry = [...MongoDBTools, MyCustomTool];`.

Tool classes must conform to `ToolClass` — static `toolName` (unique), `category` (`"mongodb" | "atlas" | "atlas-local" | "assistant" | "custom"`), and `operationType`. Constructors receive `{ server, transportRequest }` where `server` is the request-scoped `ToolServer` carrying the individually-injected services (`server.logger`, `server.telemetry`, `server.elicitation`, `server.config`, `server.keychain`, `server.metrics`, ...) plus the shared infrastructure (`server.mcpServer`, `server.tools`, `server.isToolCategoryAvailable`); there is no session object. The `TServices` generic narrows the app-level services a tool category reads (e.g. `MongoDBToolServer` adds `connectionRegistry`/`connectionErrorHandler`/`exportsManager`). Per-request data — the raw request, signal, request id, headers, client identity — travels on the `request` argument of `execute(args, { request })` (`ToolExecutionContext.request`); the effective config lives on `this.server.config`. Use `formatUntrustedData` (from `@mongodb-js/mcp-core`) to format arbitrary data in tool output, and `Elicitation` (from `@mongodb-js/mcp-core`) for multi-round-trip confirmation/input.

### Use Case 4: Selective Tool Registration

The built-in tools are exported as arrays per category. Select or filter them freely:

```typescript
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
import { AtlasTools } from "@mongodb-js/mcp-tools-atlas";
import { AtlasLocalTools } from "@mongodb-js/mcp-tools-atlas-local";
import { AssistantTools } from "@mongodb-js/mcp-tools-assistant";

// Only MongoDB read and metadata tools
const readOnlyTools = MongoDBTools.filter(
  (Tool) => Tool.operationType === "read" || Tool.operationType === "metadata"
);

// Only atlas tools
const tools = [...AtlasTools];

// Standard bundle, no assistant
const standard = [...MongoDBTools, ...AtlasTools, ...AtlasLocalTools];
```

`Tool.operationType` and `Tool.category` are static properties on each tool class, so filtering by them is type-safe.

## API Reference

### `@mongodb-js/mcp-cli`

| Symbol                                                                                                                                                       | Description                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `runMcpCli({ args, serverMetadata, consoleLogger, onExit, tools, resources, handlers? })`                                                                    | Run the full CLI: parse config → handlers → create infrastructure → start server                                                                |
| `CliServer` / `CliServerOptions`                                                                                                                             | The request-scoped server wrapping the `McpServer`; a fresh instance per HTTP request / stdio connection                                        |
| `parseUserConfig({ args })`                                                                                                                                  | Parse CLI args/env into `{ error, warnings, parsed }`                                                                                           |
| `UserConfigSchema`, `configRegistry`, `ALL_CONFIG_KEYS`                                                                                                      | Config schema and registry                                                                                                                      |
| `applyConfigOverrides`, `getConfigMeta`, `nameToConfigKey`                                                                                                   | Request-level config overrides (HTTP headers / query params)                                                                                    |
| `createSharedServicesFromConfig({ config, serverMetadata, tools, resources, logger })`                                                                       | Build app-level infra shared by every request-scoped server (metrics, keychain, connection store/registry, API client, exports, telemetry, ...) |
| `createServerFromConfig({ config, sharedServices, request? })`                                                                                               | Build one request-scoped `CliServer` from a resolved config and shared services                                                                 |
| `createRunnerFromConfig({ config, serverMetadata, tools, resources, logger })`                                                                               | Build shared services + the transport runner only (`CliStdioRunner` / `StreamableHttpRunner`)                                                   |
| `createHttpTransportRunnerFromConfig(sharedServices)`                                                                                                        | Build the HTTP transport runner with a `CliMcpHttpServer` (fresh `CliServer` per request)                                                       |
| `CliMcpHttpServer` / `CliStdioRunner`                                                                                                                        | HTTP / stdio servers that build a fresh request-scoped `CliServer` per request                                                                  |
| `closeSharedServices(sharedServices)` / `SharedServerServices`                                                                                               | Release app-level services on shutdown / the shared app-level services container                                                                |
| `startRunner({ transportRunner, logger, onExit })`                                                                                                           | Start the runner and manage graceful shutdown                                                                                                   |
| `createLoggerFromConfig` / `createApiClientFromConfig` / `createExportsManagerFromConfig` / `createTelemetryFromConfig` / `createMonitoringServerFromConfig` | Individual infrastructure factories                                                                                                             |
| `Resources`, `ConfigResource`, `DebugResource`, `ExportedData`                                                                                               | Built-in MCP resources                                                                                                                          |
| `HelpHandler`, `VersionHandler`, `DryRunHandler`                                                                                                             | CLI handlers                                                                                                                                    |

| Types | `ToolRegistry`, `ResourceRegistry`, `RunMcpCliOptions`, `SharedServerServices` |

### `@mongodb-js/mcp-core`

| Symbol                                                                                | Description                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ToolBase`, `ToolClass`, `ToolArgs`, `ToolResult`, `formatUntrustedData`              | Custom tool authoring                                                                                                                                         |
| `toToolExecutionContext`                                                              | Adapts the SDK `ServerContext` to a `ToolExecutionContext` (builds the per-request object; the request-scoped server is carried on the tool, not the request) |
| `StdioRunner({ logger })`                                                             | Abstract stdio transport runner (`serveStdio`; override `createServer()` to return a registered `McpServer`)                                                  |
| `InMemoryTransport`                                                                   | In-memory transport for tests                                                                                                                                 |
| `SessionStore`, `createDefaultSessionStore`                                           | **Deprecated** legacy 2025-era HTTP session store                                                                                                             |
| `Keychain`, `registerGlobalSecretToRedact`                                            | Secret storage/redaction (the `IRedactor` type lives in `@mongodb-js/mcp-types`); `Keychain.redact(value)` replaces the removed `allSecrets` field            |
| `Elicitation`                                                                         | Multi-round-trip confirmation/input (`confirmationRequired`/`readConfirmation`/`inputRequired`/`readInput`)                                                   |
| `NoopLogger`, `NoopTelemetry`, `LoggerBase`, `RedactingLoggerBase`, `CompositeLogger` | Logging/telemetry primitives                                                                                                                                  |
| `McpServer` (re-export)                                                               | `@modelcontextprotocol/server`                                                                                                                                |

### `@mongodb-js/mcp-http-runners`

| Symbol                                                 | Description                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamableHttpRunner` / `StreamableHttpRunnerOptions` | HTTP transport runner                                                                                                                                                                                                                                   |
| `MCPHttpServer` / `MCPHttpServerOptions`               | HTTP server; override abstract `createServerForRequest(request: TransportRequestContext): Promise<TServer>`. `options.http.authMode` is required (`"authenticated"` \| `"unauthenticated"`); `sessionOptions` is for the legacy 2025-era lifecycle only |
| `MonitoringServer` / `MonitoringServerOptions`         | Optional `/metrics` monitoring server                                                                                                                                                                                                                   |
| `ExpressBasedHttpServer`                               | Base class for Express-based HTTP servers                                                                                                                                                                                                               |

### Other packages

| Package                             | Symbols                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mongodb-js/mcp-tools-mongodb`     | `MongoDBTools`, `MongoDBToolBase`, `MongoDBToolServer`, `MongoDBToolServices`, `MCPConnectionManager`, `ConnectionManager`, `MCPConnectionStore`, `ErrorCodes`, `MongoDBError`, exports manager & connection types                                                                                                                     |
| `@mongodb-js/mcp-tools-atlas`       | `AtlasTools`, `AtlasToolBase`                                                                                                                                                                                                                                                                                                          |
| `@mongodb-js/mcp-tools-atlas-local` | `AtlasLocalTools`, `createAtlasLocalClient`                                                                                                                                                                                                                                                                                            |
| `@mongodb-js/mcp-tools-assistant`   | `AssistantTools`                                                                                                                                                                                                                                                                                                                       |
| `@mongodb-js/mcp-atlas-api-client`  | `ApiClient`, `ClientCredentialsAuthProvider`                                                                                                                                                                                                                                                                                           |
| `@mongodb-js/mcp-atlas-telemetry`   | `AtlasTelemetry` (`create({ logger, deviceId, apiClient, keychain, enabled, serverMetadata })`), `TelemetryConfig`, `TelemetryBaseEvent`, `TelemetryCommonProperties`                                                                                                                                                                  |
| `@mongodb-js/mcp-logging`           | `ConsoleLogger`, `DiskLogger`, `McpLogger`                                                                                                                                                                                                                                                                                             |
| `@mongodb-js/mcp-metrics`           | `PrometheusMetrics`, `createDefaultMetrics`                                                                                                                                                                                                                                                                                            |
| `@mongodb-js/mcp-ui`                | `UIRegistry`                                                                                                                                                                                                                                                                                                                           |
| `@mongodb-js/mcp-types`             | `ServerMetadata`, `TransportRequestContext`, `RequestAuthState`, `RequestAuthInfo`, `ToolCategory`, `OperationType`, `UserConfig`, `IMetrics`, `DefaultMetricDefinitions`, `ITransportRunner`, `BaseServer`, `ToolServer`, `ToolServices`, `ToolRequest`, `ToolExecutionContext`, `ResourceServices`, `ResourceServerArg`, `IRedactor` |

## Advanced Topics

### Transports

**Stdio:** subclass `StdioRunner` (or use `CliStdioRunner`) and override `createServer()` to return a **registered** `CliServer`/`McpServer` (one per stdio connection). The constructor takes only the logger — server creation is a method override, mirroring the HTTP pattern:

```typescript
import { StdioRunner } from "@mongodb-js/mcp-core";
import { createServerFromConfig } from "@mongodb-js/mcp-cli";

class MyStdioRunner extends StdioRunner {
  protected override async createServer() {
    const server = createServerFromConfig({ config, sharedServices });
    await server.register(); // register tools/resources/capabilities without a transport
    return server.mcpServer;
  }
}

const runner = new MyStdioRunner({ logger });
await runner.start();
```

**HTTP:** `StreamableHttpRunner` attaches a `MCPHttpServer` to the transport. The runners `start()` the server and `close()` it; per-request server creation happens in `MCPHttpServer.createServerForRequest`. Optionally add a `MonitoringServer` for Prometheus metrics. See [Use Case 2](#use-case-2-request-scoped-configuration) for a full wiring example.

**CLI default (request-scoped servers):** the CLI's `createHttpTransportRunnerFromConfig` wires a `CliMcpHttpServer` that creates a **fresh request-scoped `CliServer` per HTTP request** via `createServerFromConfig`, applying request-level config overrides (`applyConfigOverrides`) on each request — so concurrent HTTP requests are isolated (separate servers, request-scoped connection registry views, telemetry). App-level infrastructure (metrics, device id, shared connection store, API client, exports, telemetry, Atlas Local client) is built once by `createSharedServicesFromConfig` and shared. Stdio builds a single server (one client per connection).

### Configuration and request overrides

`parseUserConfig` reads CLI args and env vars, producing the effective `UserConfig`. When `allowRequestOverrides` is enabled, clients may override config per request via HTTP headers (`x-mongo-config-*`) or query parameters (`x-mongo-config-*`); `applyConfigOverrides({ baseConfig, request })` applies those overrides. `configRegistry` describes every config field, its overridability, and its comparison behavior.

### Telemetry

`AtlasTelemetry.create({ logger, deviceId, apiClient, keychain, enabled, serverMetadata })` from `@mongodb-js/mcp-atlas-telemetry`. `keychain` and `serverMetadata` are required — `serverMetadata` is your `ServerMetadata` (`mcpServerName`, `version`, `engines`). To customize common properties, subclass `AtlasTelemetry` and override `getCommonProperties()`. In tests use `NoopTelemetry` from `@mongodb-js/mcp-core`.

### Logging

```typescript
import { McpLogger } from "@mongodb-js/mcp-logging";

new McpLogger({
  server: mcpServer,
  options: { logLevel: server.mcpLogLevel },
  keychain,
});
```

`ConsoleLogger` writes to the console; `DiskLogger` writes to disk. All loggers accept options objects (e.g. `new LoggerBase({ keychain })`).

### Connection management

`MCPConnectionManager` / `MCPConnectionStore` (from `@mongodb-js/mcp-tools-mongodb`) manage MongoDB connections with display-name sanitization, redaction, and connection state tracking. In the sessionless model the connection registry lives once at the app level (`connectionStore`); `createServerFromConfig` gives each request-scoped server a **view** of it (`connectionStore.view({ scope, owned })`) so connections are scoped per request (stable per identified client, ephemeral for anonymous requests) and addressed by opaque `connectionId`. `connectionErrorHandler`, `ErrorCodes`, and `MongoDBError` cover user-facing connection errors. Use `formatUntrustedData` (from `@mongodb-js/mcp-core`) when echoing untrusted data back to clients.

### UI resources

`UIRegistry` (from `@mongodb-js/mcp-ui`) registers the MCP UI components (e.g. `ListDatabases`) exposed as MCP resources. The default `Resources` from `@mongodb-js/mcp-cli` already includes them.

## Examples

### Example 1: Custom CLI with a custom tool

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
  mcpServerName: "my-product-mcp",
  version: "1.0.0",
  engines: { node: process.version },
};

const tools = [...MongoDBTools, ...AtlasTools];

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

### Example 2: Full custom HTTP host with request-scoped config

See [Use Case 2](#use-case-2-request-scoped-configuration) for the complete `MCPHttpServer`-based wiring, including `createSharedServicesFromConfig`, a custom `MCPHttpServer` and `StreamableHttpRunner`.

### Example 3: Custom tool class

See [Use Case 3](#use-case-3-adding-custom-tools) for the `ToolBase` subclass pattern (static `toolName`/`category`/`operationType`, `description`, zod `argsShape`, `execute`, `resolveTelemetryMetadata`).

## Migrating from the v1 single-package API

The pre-v3 `mongodb-mcp-server` single-package library API (`Server`, `Session`, `StreamableHttpRunner.createServerForRequest`, `mongodb-mcp-server/tools` and `/web` entry points, `defaultCreate*` helpers, positional constructor arguments, …) is **removed** in v3. See the repository's [v1 → v3 migration guide](skills/mongodb-mcp-v3-migration/SKILL.md) for the complete symbol-by-symbol mapping, or run the migration skill's inventory script to scan your consumer code.
