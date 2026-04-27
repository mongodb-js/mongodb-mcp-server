## Monorepo Migration

### Summary

This project started as a single monolithic npm package. As we're scaling and especially as we have started to embed MCP in other projects, the monolith approach causes a number of issues:

1. The design of our library components is too tied to our user-facing CLI. For example, we use `userConfig` — a global store tied to publicly configurable CLI fields — which means non-CLI library consumers are inherently coupled to CLI decisions.
2. One package means all dependencies (such as `inquirer` used by the startup script and atlas-local packages) get bundled into any consumer of the library, regardless of whether that functionality is used. For consumers like Compass, this requires more patches for web compatibility and manual removal of some bundled dependencies through webpack.
3. It is hard to test and audit any subcomponent of the MCP server in isolation because of their tight coupling with the rest of the system.

This proposal solves this by defining an explicit library package separate from the binary and splitting the rest of the logic into submodules.

### Proposal

Split the codebase into the following packages inside a Node.js/npm monorepo, with packages living inside `packages/*`:

- **`mongodb-mcp-server`** — A simple Node.js CLI entry point consuming the `@mongodb-js/mcp-core` library and user config definitions. Roughly matches `index.ts` + setup and `UserConfig` logic today.
- **`@mongodb-js/mcp-tools-{...}`** — Tool packages grouped by functionality and underlying dependencies (e.g. Atlas, Atlas Local, MongoDB).
- **`@mongodb-js/mcp-api`** — Common interfaces and logic shared across different services and tools.
- **`@mongodb-js/mcp-core`** — Built-in implementations for the API.
- **`@mongodb-js/mcp-*`** — Various internal packages for specific use cases.

### Package Breakdown

#### Layer 1 — Core

##### `@mongodb-js/mcp-api`

**Scope:** Private, internal

The primary purpose of this package is to define common interfaces and be implementation-independent. All subpackages use the API interface definitions and define specific implementations accordingly.

This is a `devDependency` for nearly all packages, as it only exports types. `@mongodb-js/mcp-core` provides a default implementation for core components such as `Session` and `Keychain`.

**Interfaces:** `Session`, `ToolBase`, `ToolClass`, `ToolRegistrar`, `Keychain`, `Elicitation`, `SessionStore`, `Resources`, `ErrorCodes`, helpers (`deviceId`, `connectionOptions`, etc.), `CompositeLogger`, `ApiClientLike`, `Metrics`, `UIRegistry`, `LoggerBase`, `TransportRunner`, `Telemetry`

**Refactoring:** Eliminate `TUserConfig` generics from all classes. Classes accept explicit typed options instead.

---

#### Layer 2 — Public API

These packages implement the functionality described by the interfaces in `@mongodb-js/mcp-api`.

##### 2a. Core

Core provides implementations for core mcp-api services which are environment-independent and not overly complex, such as `Session`. Elements of core can later be split into their own packages if needed.

##### `@mongodb-js/mcp-core`

**Depends on:** `mcp-api`

**Contains:** `Session`, `ToolBase`, `ToolClass`, `ToolRegistrar` implementation, `Keychain`, `Elicitation`, `SessionStore`, `Resources`, `ErrorCodes`, helpers (`deviceId`, `connectionOptions`, etc.), `CompositeLogger`, `BaseTransportRunner`, `BaseLogger`, `McpLogger`, `NoopLogger` (renamed from `NullLogger`), `LogId`, log types, `Telemetry` class, `Server` class, `NoopMetrics`

Re-exports interfaces from `mcp-api` as needed.

---

##### 2b. Primitives

Implementations of shared (`mcp-atlas-api-client`), more complex (`mcp-transports`), optional (`mcp-ui`), or environment-specific (`mcp-prom-metrics`) elements of the API.

##### `@mongodb-js/mcp-atlas-api-client`

**Depends on:** `mcp-api`

**Contains:** `ApiClient`, `AuthProvider`, OpenAPI types, `defaultCreateApiClient`

**Refactoring:** `sendEvents()` accepts generic `T[]` instead of `TelemetryEvent[]`. `userAgent` passed via options instead of importing `packageInfo`.

---

##### `@mongodb-js/mcp-cli-logging`

**Depends on:** `mcp-core`

**Contains:** `ConsoleLogger`, `DiskLogger`, CLI log definitions

---

##### `@mongodb-js/mcp-cli-telemetry`

**Depends on:** `mcp-core`, `mcp-atlas-api-client`

**Contains:** `TelemetryEvent` definitions, `EventCache`, `CommonProperties`

---

##### `@mongodb-js/mcp-transports`

**Depends on:** `mcp-api`

**Contains:** `StdioRunner`, `StreamableHttpRunner`, `MCPHttpServer`, `MonitoringServer`, `DryRunModeRunner`, `InMemoryTransport`

**Refactoring:** Runners accept typed options instead of `UserConfig`. `ServerFactory` callback injection.

---

##### `@mongodb-js/mcp-prom-metrics`

**Contains:** `PrometheusMetrics`

---

##### `@mongodb-js/mcp-ui`

**Depends on:** `mcp-api`

**Contains:** `UIRegistry`, bundled HTML loaders, React components (devDeps only)

---

##### `@mongodb-js/mcp-tools-mongodb`

**Depends on:** `mcp-api`

**Contains:** `ConnectionManager`, `MongoDBToolBase`, ~24 MongoDB tools

**Exports:** `MongoDBTools: ToolClass[]`

---

##### `@mongodb-js/mcp-tools-atlas`

**Depends on:** `mcp-api`, `mcp-atlas-api-client`

**Contains:** `AtlasToolBase`, ~18 Atlas tools, cluster/roles/accessList helpers

**Exports:** `AtlasTools: ToolClass[]`

---

##### `@mongodb-js/mcp-tools-atlas-local`

**Depends on:** `mcp-api`

**Contains:** Atlas Local client factory, dynamic loader for `@mongodb-js/atlas-local`, Docker detection, `AtlasLocalToolBase`, ~4 tools

**Exports:** `AtlasLocalTools: ToolClass[]`

---

##### `@mongodb-js/mcp-tools-assistant`

**Depends on:** `mcp-api`

**Contains:** `AssistantToolBase`, ~2 tools

**Exports:** `AssistantTools: ToolClass[]`

---

#### Layer 3 — Binary

##### `mongodb-mcp-server`

**Depends on:** `mcp-core`, all four tool packages, `mcp-ui`

**Contains:** `UserConfigSchema`, `parseUserConfig`, `AllTools` composition, FIPS setup, process lifecycle (signals, exit), `--help`/`--version`/`--dryRun`, setup subcommand delegation, transport selection, interactive setup wizard (`runSetup`, AI tool registry, platform detection)

**Notes:** The real binary. Maps parsed `UserConfig` into typed options for transport runners. This is the only package that touches `process.argv` or `process.exit`.
