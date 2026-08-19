# Developer's Guide to Embedding and Extending the MongoDB MCP Server

This guide explains how to embed and extend the MongoDB MCP Server as a library to customize its core functionality and behavior for your specific use cases. It documents the **v3** API: the monorepo of scoped `@mongodb-js/mcp-*` packages.

> **Migrating from the pre-v3 single-package API?** The `mongodb-mcp-server` package is **not** a library in v3 — see the [v1 → v3 migration guide](skills/mongodb-mcp-v3-migration/SKILL.md) (in the repository) for how to update consumer code.

## 📚 Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [Use Cases](#use-cases)
  - [Use Case 1: Override Server Configuration](#use-case-1-override-server-configuration)
  - [Use Case 2: Per-Session Configuration](#use-case-2-per-session-configuration)
  - [Use Case 3: Adding Custom Tools](#use-case-3-adding-custom-tools)
  - [Use Case 4: Selective Tool Registration](#use-case-4-selective-tool-registration)
- [API Reference](#api-reference)
- [Advanced Topics](#advanced-topics)
- [Examples](#examples)

## Overview

In v3 the MongoDB MCP Server is a **monorepo of scoped packages** under the `@mongodb-js/mcp-*` naming. The `mongodb-mcp-server` package itself is now a **binary-only** distribution (`npx mongodb-mcp-server` / the MCPB bundle) — it is **not** an importable library.

To embed or extend the server, depend on the scoped packages instead. The library exports provide full control over:

- Server configuration and initialization — `runMcpCli`, `createRunnerFromConfig`, `createServerFromConfig`, `startRunner`
- Per-session (MCP Client session) configuration hooks — `MCPHttpServer.createServerForRequest`
- Tool registration — `ToolBase` / `ToolClass` tool classes and `ToolRegistry` arrays
- Connection management and connection error handling — `MCPConnectionManager`, `connectionErrorHandler`

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

| Package                            | Role                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mongodb-js/mcp-cli`              | **Primary entry point.** Custom CLI (`runMcpCli`), server+session classes (`CliServer`, `Session`), config (`parseUserConfig`, `UserConfigSchema`, `configRegistry`, `applyConfigOverrides`), `create*FromConfig` factories, `Resources`, CLI handlers |
| `@mongodb-js/mcp-core`             | Transports (`StdioRunner`, `InMemoryTransport`), `SessionStore`, `Keychain`, `Elicitation`, `NoopLogger`, `NoopTelemetry`, tool base classes (`ToolBase`, `ToolClass`)                                                                                 |
| `@mongodb-js/mcp-http-runners`     | HTTP transport (`StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`)                                                                                                                                                                           |
| `@mongodb-js/mcp-types`            | Shared types (`ServerMetadata`, `TransportRequestContext`, `ToolCategory`, `OperationType`, `UserConfig`, …)                                                                                                                                           |
| `@mongodb-js/mcp-tools-*`          | Tool bundles: `@mongodb-js/mcp-tools-mongodb`, `-atlas`, `-atlas-local`, `-assistant`                                                                                                                                                                  |
| `@mongodb-js/mcp-atlas-api-client` | Atlas Admin API client (`ApiClient`, `ClientCredentialsAuthProvider`)                                                                                                                                                                                  |
| `@mongodb-js/mcp-atlas-telemetry`  | Telemetry pipeline (`AtlasTelemetry`)                                                                                                                                                                                                                  |
| `@mongodb-js/mcp-logging`          | Loggers (`ConsoleLogger`, `DiskLogger`, `McpLogger`)                                                                                                                                                                                                   |
| `@mongodb-js/mcp-metrics`          | Metrics (`PrometheusMetrics`, `createDefaultMetrics`)                                                                                                                                                                                                  |
| `@mongodb-js/mcp-ui`               | MCP UI registry (`UIRegistry`)                                                                                                                                                                                                                         |

### Customizing Server Behavior

There are three main approaches:

1. **`runMcpCli` (recommended for CLIs)**: one call that parses config, runs handlers, creates the server and infrastructure, and starts stdio or HTTP transport — the same flow the official binary uses.
2. **`createServerFromConfig` + `createRunnerFromConfig` + `startRunner`**: split the same flow so you can replace individual dependencies (logger, API client, telemetry, monitoring server) via `create*FromConfig` factories, or create just the server (`createServerFromConfig`) and wire a custom runner.
   - `createServerFromConfig({ config, serverMetadata, tools, resources, logger })` builds `{ server, config, logger, metrics, monitoringServer }`.
   - `createRunnerFromConfig` calls it internally and returns only the configured transport runner (`StdioRunner` for stdio, `StreamableHttpRunner` for HTTP).
   - `startRunner({ transportRunner, logger, onExit })` starts the runner and manages the server lifecycle (signal handlers, graceful shutdown).
3. **Override `MCPHttpServer.createServerForRequest`**: when hosting over HTTP and you need per-request (per-session) customization, subclass `MCPHttpServer` and override its `createServerForRequest(request: TransportRequestContext)` instead. In v3 this hook lives on `MCPHttpServer`, **not** on `StreamableHttpRunner`.

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

- **Transport runners**: `StdioRunner` (stdio) and `StreamableHttpRunner` (HTTP) manage the MCP transport layer. Runners attach a pre-built server — they no longer build one for you.
- **`CliServer`**: wraps the MCP server and registers tools and resources; created per session.
- **`Session`**: per-client (MCP Client) connection and configuration state, including `session.config` (the effective `UserConfig`).
- **Tools**: individual capabilities exposed to the MCP client, implemented as `ToolBase` subclasses and grouped into bundle arrays (`MongoDBTools`, `AtlasTools`, …).
- **Configuration**: `UserConfig` parsed via `parseUserConfig`/`UserConfigSchema`, with request-level override mechanisms (`applyConfigOverrides`, `configRegistry`).

## Use Cases

### Use Case 1: Override Server Configuration

Configure the MCP server with custom settings, such as HTTP headers for authentication before establishing a session for an MCP client, or replace parts of the default infrastructure.

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

const logger = await createLoggerFromConfig({ config, keychain: Keychain.root });
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

await startRunner({ transportRunner, logger, onExit: (code) => process.exit(code) });
```

Clients connecting to this server must include the specified headers in their requests, otherwise their session initialization request is declined.

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

### Use Case 2: Per-Session Configuration

Customize the server for each MCP client session — enabling user-specific permissions and settings based on request headers, query parameters, or authentication context — by subclassing **`MCPHttpServer`** and overriding `createServerForRequest(request: TransportRequestContext)`.

> The v1 pattern of overriding `createServerForRequest` on `StreamableHttpRunner` is **removed** in v3. Runners no longer create servers.

#### Example: User-Based Tool Permissions (HTTP)

```typescript
import {
  MCPHttpServer,
  StreamableHttpRunner,
} from "@mongodb-js/mcp-http-runners";
import {
  parseUserConfig,
  createLoggerFromConfig,
  createApiClientFromConfig,
  createExportsManagerFromConfig,
  Session,
  type McpSession,
} from "@mongodb-js/mcp-cli";
import {
  SessionStore,
  Keychain,
  Elicitation,
  NoopTelemetry,
  McpServer,
  getRandomUUID,
} from "@mongodb-js/mcp-core";
import {
  MCPConnectionStore,
  MongoDBTools,
  connectionErrorHandler,
  DeviceId,
  type ConnectionRegistry,
} from "@mongodb-js/mcp-tools-mongodb";
import { createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type {
  TransportRequestContext,
  ServerMetadata,
  UserConfig,
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

// Shared infrastructure, built once (from the base config)
const { parsed: baseConfig } = parseUserConfig({ args: process.argv.slice(2) });
const keychain = Keychain.root;
const logger = await createLoggerFromConfig({ config: baseConfig, keychain });
const apiClient = createApiClientFromConfig({
  config: baseConfig,
  serverMetadata,
  logger,
});
const exportsManager = createExportsManagerFromConfig({ config: baseConfig });
const metrics = createDefaultMetrics();
const deviceId = DeviceId.create(logger);
const connectionStore = new MCPConnectionStore({
  options: baseConfig,
  logger,
  deviceId,
});
const connectionRegistry: ConnectionRegistry = connectionStore.view({
  scope: baseConfig.connectionScope === "session" ? getRandomUUID() : undefined,
  owned: true,
});

// Per-session factory: build a Session + CliServer from a per-request UserConfig
function createServerFromConfig(config: UserConfig): {
  session: McpSession;
  server: CliServer;
} {
  const mcpServer = new McpServer({
    name: serverMetadata.mcpServerName,
    version: serverMetadata.version,
  });

  const session = new Session({
    logger,
    exportsManager,
    connectionRegistry,
    keychain,
    connectionErrorHandler,
    apiClient,
    config,
  });

  return {
    session,
    server: new CliServer({
      session,
      mcpServer,
      telemetry: new NoopTelemetry(),
      elicitation: new Elicitation({
        server: mcpServer.server,
        timeoutMs: config.elicitationTimeoutMs ?? 30_000,
      }),
      connectionErrorHandler,
      metrics,
      serverMetadata,
      tools: MongoDBTools,
    }),
  };
}

class PermissionsMCPHttpServer extends MCPHttpServer {
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

    return createServerFromConfig({
      ...baseConfig,
      disabledTools,
      readOnly: permissions.role === "analyst",
      maxDocumentsPerQuery: permissions.maxDocuments,
    }).server;
  }
}

const sessionStore = new SessionStore({
  options: {
    idleTimeoutMs: baseConfig.idleTimeoutMs,
    notificationTimeoutMs: baseConfig.notificationTimeoutMs,
  },
  logger,
  metrics,
});

const mcpHttpServer = new PermissionsMCPHttpServer({
  options: {
    http: {
      host: baseConfig.httpHost,
      port: baseConfig.httpPort,
      bodyLimit: baseConfig.httpBodyLimit,
      headers: baseConfig.httpHeaders,
      responseType: baseConfig.httpResponseType,
    },
    session: {
      idleTimeoutMs: baseConfig.idleTimeoutMs,
      notificationTimeoutMs: baseConfig.notificationTimeoutMs,
      externallyManagedSessions: baseConfig.externallyManagedSessions,
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
});
await runner.start();
```

> **Note:** In this example `deviceId`, `connectionErrorHandler`, `MongoDBTools`, and `MCPConnectionStore` come from `@mongodb-js/mcp-tools-mongodb` (see [Connection management](#connection-management)); a real embedding typically wires the shared infrastructure once (as `createServerFromConfig` does) and builds only the `Session`/`CliServer` per request. MongoDB connection state deliberately lives at the app level (`ConnectionRegistry`), not in the session — tools address connections by `connectionId`.

````

### Use Case 3: Adding Custom Tools

Implement custom tools by extending `ToolBase` from `@mongodb-js/mcp-core`:

```typescript
import { ToolBase, type ToolClass, type ToolCategory, type OperationType } from "@mongodb-js/mcp-core";
import type { IToolSession } from "@mongodb-js/mcp-types";
import { z } from "zod";

class MyCustomTool extends ToolBase<IToolSession> {
  static toolName = "my-custom-tool";
  static category: ToolCategory = "custom";
  static operationType: OperationType = "read";

  public description = "My custom tool description";
  public argsShape = {
    query: z.string().describe("The query parameter"),
  };

  protected async execute(args) {
    // Tool implementation — arguments are inferred from argsShape
    return {
      content: [{ type: "text", text: "Result" }],
      structuredContent: { query: args.query },
    };
  }

  protected resolveTelemetryMetadata() {
    return {};
  }
}
````

Register the class by including it in the `tools` array (a `ToolRegistry`) passed to `runMcpCli`, `createRunnerFromConfig`, `createServerFromConfig`, or `CliServer`: `const tools: ToolRegistry = [...MongoDBTools, MyCustomTool];`.

Tool classes must conform to `ToolClass` — static `toolName` (unique), `category` (`"mongodb" | "atlas" | "atlas-local" | "assistant" | "custom"`), and `operationType`. The server injects `session`, `telemetry`, and `elicitation` automatically via the `ToolConstructorParams`. Use `formatUntrustedData` (from `@mongodb-js/mcp-core`) to format arbitrary data in tool output, and `Elicitation` (from `@mongodb-js/mcp-core`) to request user confirmation.

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

| Symbol                                                                                                                                                       | Description                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `runMcpCli({ args, serverMetadata, consoleLogger, onExit, tools, resources, handlers? })`                                                                    | Run the full CLI: parse config → handlers → create infrastructure → start server |
| `CliServer` / `CliServerOptions`                                                                                                                             | Core server wrapping the MCP server; created per session                         |
| `Session` / `SessionOptions`                                                                                                                                 | Per-client session with `session.config` (effective `UserConfig`)                |
| `parseUserConfig({ args })`                                                                                                                                  | Parse CLI args/env into `{ error, warnings, parsed }`                            |
| `UserConfigSchema`, `configRegistry`, `ALL_CONFIG_KEYS`                                                                                                      | Config schema and registry                                                       |
| `applyConfigOverrides`, `getConfigMeta`, `nameToConfigKey`                                                                                                   | Request-level config overrides (HTTP headers / query params)                     |
| `createServerFromConfig({ config, serverMetadata, tools, resources, logger })`                                                                               | Build `{ server, config, logger, metrics, monitoringServer }`                    |
| `createRunnerFromConfig({ config, serverMetadata, tools, resources, logger })`                                                                                | Build the transport runner only (`StdioRunner` or `StreamableHttpRunner`)        |
| `createHttpTransportRunnerFromConfig({ config, server, logger, metrics, monitoringServer })`                                                                  | Build the HTTP transport runner explicitly                                       |
| `startRunner({ transportRunner, logger, onExit })`                                                                                                            | Start the runner and manage graceful shutdown                                    |
| `createLoggerFromConfig` / `createApiClientFromConfig` / `createExportsManagerFromConfig` / `createTelemetryFromConfig` / `createMonitoringServerFromConfig` | Individual infrastructure factories                                              |
| `Resources`, `ConfigResource`, `DebugResource`, `ExportedData`                                                                                               | Built-in MCP resources                                                           |
| `HelpHandler`, `VersionHandler`, `DryRunHandler`                                                                                                             | CLI handlers                                                                     |
| `SharedSessionMCPHttpServer`                                                                                                                                 | `MCPHttpServer` variant sharing a single session                                 |
| Types                                                                                                                                                        | `ToolRegistry`, `ResourceRegistry`, `McpSession`, `RunMcpCliOptions`             |

### `@mongodb-js/mcp-core`

| Symbol                                                                                            | Description                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `ToolBase`, `ToolClass`, `ToolConstructorParams`, `ToolArgs`, `ToolResult`, `formatUntrustedData` | Custom tool authoring              |
| `StdioRunner({ logger, server })`                                                                 | Stdio transport runner             |
| `InMemoryTransport`                                                                               | In-memory transport for tests      |
| `SessionStore`, `createDefaultSessionStore`                                                       | HTTP session store                 |
| `Keychain`, `registerGlobalSecretToRedact`, `redactValues`                                        | Secret storage/redaction           |
| `Elicitation`                                                                                     | User confirmation requests         |
| `NoopLogger`, `NoopTelemetry`, `LoggerBase`, `CompositeLogger`                                    | Logging/telemetry primitives       |
| `McpServer` (re-export)                                                                           | `@modelcontextprotocol/sdk` server |

### `@mongodb-js/mcp-http-runners`

| Symbol                                                 | Description                                                                                                 |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `StreamableHttpRunner` / `StreamableHttpRunnerOptions` | HTTP transport runner                                                                                       |
| `MCPHttpServer` / `MCPHttpServerOptions`               | HTTP server; override abstract `createServerForRequest(request: TransportRequestContext): Promise<TServer>` |
| `MonitoringServer` / `MonitoringServerOptions`         | Optional `/metrics` monitoring server                                                                       |
| `ExpressBasedHttpServer`                               | Base class for Express-based HTTP servers                                                                   |

### Other packages

| Package                             | Symbols                                                                                                                                                                            |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@mongodb-js/mcp-tools-mongodb`     | `MongoDBTools`, `MongoDBToolBase`, `MCPConnectionManager`, `ConnectionManager`, `ErrorCodes`, `MongoDBError`, exports manager & connection types                                   |
| `@mongodb-js/mcp-tools-atlas`       | `AtlasTools`, `AtlasToolBase`                                                                                                                                                      |
| `@mongodb-js/mcp-tools-atlas-local` | `AtlasLocalTools`, `createAtlasLocalClient`                                                                                                                                        |
| `@mongodb-js/mcp-tools-assistant`   | `AssistantTools`                                                                                                                                                                   |
| `@mongodb-js/mcp-atlas-api-client`  | `ApiClient`, `ClientCredentialsAuthProvider`                                                                                                                                       |
| `@mongodb-js/mcp-atlas-telemetry`   | `AtlasTelemetry` (`create({ logger, deviceId, apiClient, keychain, enabled, serverMetadata })`), `TelemetryConfig`, `TelemetryBaseEvent`, `TelemetryCommonProperties`              |
| `@mongodb-js/mcp-logging`           | `ConsoleLogger`, `DiskLogger`, `McpLogger`                                                                                                                                         |
| `@mongodb-js/mcp-metrics`           | `PrometheusMetrics`, `createDefaultMetrics`                                                                                                                                        |
| `@mongodb-js/mcp-ui`                | `UIRegistry`                                                                                                                                                                       |
| `@mongodb-js/mcp-types`             | `ServerMetadata`, `TransportRequestContext`, `ToolCategory`, `OperationType`, `UserConfig`, `IMetrics`, `DefaultMetricDefinitions`, `ISession`, `IToolSession`, `ITransportRunner` |

## Advanced Topics

### Transports

**Stdio:**

```typescript
import { StdioRunner } from "@mongodb-js/mcp-core";
import { CliServer } from "@mongodb-js/mcp-cli";

const runner = new StdioRunner({ logger, server: cliServer });
await runner.start();
```

**HTTP:** `StreamableHttpRunner` attaches a `MCPHttpServer` to the transport. The runners `start()` the server and `close()` it; per-request server creation happens in `MCPHttpServer.createServerForRequest`. Optionally add a `MonitoringServer` for Prometheus metrics. See [Use Case 2](#use-case-2-per-session-configuration) for a full wiring example.

**Shared session:** `SharedSessionMCPHttpServer` (from `@mongodb-js/mcp-cli`) serves all requests through a single `CliServer` — the simplest HTTP setup when you don't need per-session configuration.

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

`MCPConnectionManager` (from `@mongodb-js/mcp-tools-mongodb`) manages MongoDB connections with display-name sanitization, redaction, and connection state tracking. `connectionErrorHandler`, `ErrorCodes`, and `MongoDBError` cover user-facing connection errors. Use `formatUntrustedData` (from `@mongodb-js/mcp-core`) when echoing untrusted data back to clients.

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

### Example 2: Full custom HTTP host with per-request config

See [Use Case 2](#use-case-2-per-session-configuration) for the complete `MCPHttpServer`-based wiring, including `SessionStore` and `StreamableHttpRunner`.

### Example 3: Custom tool class

See [Use Case 3](#use-case-3-adding-custom-tools) for the `ToolBase` subclass pattern (static `toolName`/`category`/`operationType`, `description`, zod `argsShape`, `execute`, `resolveTelemetryMetadata`).

## Migrating from the v1 single-package API

The pre-v3 `mongodb-mcp-server` single-package library API (`Server`, `Session`, `StreamableHttpRunner.createServerForRequest`, `mongodb-mcp-server/tools` and `/web` entry points, `defaultCreate*` helpers, positional constructor arguments, …) is **removed** in v3. See the repository's [v1 → v3 migration guide](skills/mongodb-mcp-v3-migration/SKILL.md) for the complete symbol-by-symbol mapping, or run the migration skill's inventory script to scan your consumer code.
