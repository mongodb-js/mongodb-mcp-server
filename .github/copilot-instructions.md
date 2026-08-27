# Project Overview

This project is a **monorepo** implementing the MCP (Model Context Protocol) server that lets users interact with their MongoDB clusters and MongoDB Atlas accounts. It is built using TypeScript, Node.js, pnpm workspaces, and the official `@modelcontextprotocol` v2 SDK packages (`client`, `server`, `core`, `node`).

The server ships as the **v3 API**: a set of scoped `@mongodb-js/mcp-*` packages. The `mongodb-mcp-server` package is the binary CLI distribution (`npx mongodb-mcp-server` / MCPB) — library embedding uses the scoped packages.

## Folder Structure

This project uses pnpm workspaces (`pnpm-workspace.yaml`). The source of the server lives in `packages/*`:

- `packages/mongodb-mcp-server`: The shipped CLI binary entrypoint and its scripts.
- `packages/cli`: CLI wiring — `runMcpCli`, `CliServer`, `Session`, `parseUserConfig`, `UserConfigSchema`, `applyConfigOverrides`, `create*FromConfig` factories, `Resources`.
- `packages/core`: Shared infrastructure — `ToolBase`/`ToolClass`, `StdioRunner`, `InMemoryTransport`, `SessionStore`, `Keychain`, `Elicitation`, `NoopLogger`, `NoopTelemetry`, `McpServer` re-export.
- `packages/http-runners`: HTTP transport — `StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`.
- `packages/tools-mongodb`: MongoDB tools (`MongoDBTools`, `MongoDBToolBase`), connection management (`MCPConnectionStore`, `MCPConnectionManager`, `ConnectionRegistry`), `ErrorCodes`, `MongoDBError`.
- `packages/tools-atlas`: Atlas Admin API tools (`AtlasTools`).
- `packages/tools-atlas-local`: Atlas Local tools (`AtlasLocalTools`).
- `packages/tools-assistant`: Assistant / knowledge tools (`AssistantTools`).
- `packages/atlas-api-client`: Atlas API client (`ApiClient`, `ClientCredentialsAuthProvider`).
- `packages/atlas-telemetry`: Telemetry pipeline (`AtlasTelemetry`).
- `packages/logging`: Loggers (`ConsoleLogger`, `DiskLogger`, `McpLogger`).
- `packages/metrics`: Metrics (`PrometheusMetrics`, `createDefaultMetrics`).
- `packages/types`: Shared types (`UserConfig`, `TransportRequestContext`, `ToolCategory`, `OperationType`, `ServerMetadata`, `McpSession`, …).
- `packages/ui`: MCP UI resources (`UIRegistry`).
- Test packages: `packages/integration-tests` (start the server and interact with it), `packages/accuracy-tests` (accuracy tests that use different models to ensure tools have reliable descriptions), `packages/eval-tests`, `packages/browser-tests`, `packages/test-utils`.
- `packages/scripts`: repo maintenance scripts (API report generation, tool argument/UI generation, release notes).

## Libraries and Frameworks

- Zod for message and schema validation.
- Express for the HTTP Transport implementation.
- mongosh NodeDriverServiceProvider for connecting to MongoDB.
- vitest for testing (run per-package).
- `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, and `@modelcontextprotocol/node` for the protocol implementation (v2 SDK).

## Coding Standards

- For declarations, use types. For usage, rely on type inference unless it is not clear enough.
- Always follow the eslint and prettier rule formats specified in `eslint.config.js` and `.prettierrc.json`.
- Use classes for stateful components and functions for stateless pure logic.
- Use dependency injection to provide dependencies between components.
- Avoid using global variables as much as possible.
- New functionality MUST be under test.
  - Tools MUST HAVE integration tests.
  - Tools MUST HAVE unit tests.
  - Tools MAY HAVE accuracy tests.

## Architectural Guidelines and Best Practices

Every agent connected to the MCP Server has a `Session` (per-session context, from `@mongodb-js/mcp-cli`; typed as `McpSession`) attached to it. The Session is the main entrypoint for dependencies to other components — any component that MUST be used by either a tool or a resource MUST be provided through the Session.

Note: MongoDB **connection state lives at the app level**, not in the Session — it lives in the `ConnectionRegistry` (from `@mongodb-js/mcp-tools-mongodb`, e.g. via `MCPConnectionStore.view()`), shared across sessions, and is addressed by the `connectionId` tool argument.

### Guidelines for All Tools

Tools extend `ToolBase` from `@mongodb-js/mcp-core` and must conform to `ToolClass` (static `toolName`, `category`, `operationType`; `description`; zod `argsShape`; `execute()`; `resolveTelemetryMetadata()`).

- The name of the tool should describe an action: `create-collection`, `insert-many`. It must be unique across the server.
- The description MUST be a simple and accurate prompt that defines what the tool does in an unambiguous way.
- All tools MUST provide a Zod schema (`argsShape`) that clearly specifies the API of the tool.
- The Operation type MUST be clear:
  - `metadata`: Reads metadata for an entity (for example, a cluster). Example: CollectionSchema.
  - `read`: Reads information from a cluster or Atlas.
  - `create`: Creates resources, like a collection or a cluster.
  - `delete`: Deletes resources or documents, like collections, documents or clusters.
  - `update`: Modifies resources or documents, like collections, documents or clusters.
  - `connect`: Connects to a MongoDB cluster.
- The tool category MUST be one of `mongodb` | `atlas` | `atlas-local` | `assistant` | `custom` (see per-category guidelines below).
- If a new tool is added, or the tool description is modified, the accuracy tests MUST be updated too.

### Guidelines for MongoDB Tools (`packages/tools-mongodb`)

- The tool category MUST be `mongodb`.
- They MUST call `this.ensureConnected()` before attempting to query MongoDB.
- They MUST return content sanitized using `formatUntrustedData`.
- Documents should be serialized with `EJSON.stringify`.
- Ensure there are proper timeout mechanisms to avoid long-running queries that can affect the server.
- Tools that require elicitation MUST implement `getConfirmationMessage` and provide an easy-to-understand message for a human running the operation.
  - If a tool requires elicitation, it must be added to the `confirmationRequiredTools` list in `packages/cli/src/config/userConfig.ts` (the `defaultUserConfig`).

### Guidelines for Atlas Tools (`packages/tools-atlas`)

- The tool category MUST be `atlas`.
- They interact with the Atlas Admin API through `ApiClient` (from `@mongodb-js/mcp-atlas-api-client`), provided via the Session (`session.apiClient`).
- Atlas tools that make slow paginated API calls should consider timeouts / limits appropriate for the server.
- If a response field comes from the Atlas API, format it with `formatUntrustedData` before returning it to the client.

### Guidelines for Assistant Tools (`packages/tools-assistant`)

- The tool category MUST be `assistant`.

### Custom Tools

- A custom tool in a consumer embedding uses category `custom` (see `MCP_SERVER_LIBRARY.md` and the v1→v3 migration skill for the embedding API).
