# Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `mongodb-mcp-server` from a monolithic `src/` into 13 discrete pnpm workspace packages, each with clear boundaries and typed APIs that don't depend on `UserConfig`.

**Architecture:** Four layers — `mcp-api` (TypeScript interfaces, no runtime code) → `mcp-core` + primitives (implementations) → tool packages (grouped by domain) → binary (`mongodb-mcp-server`, the only package that owns `UserConfig` and process lifecycle). Each non-binary package receives explicit typed options instead of `UserConfig`.

**Tech Stack:** TypeScript (NodeNext modules, `strict`), pnpm workspaces, Vitest, single ESM output per package (following `packages/metrics` convention), Zod (binary only), tsyringe DI (in `mcp-core`).

---

## Repository State

**Already in place:**
- `pnpm-workspace.yaml` includes `packages/*` ✓
- `packages/metrics/` → `@mongodb-js/mcp-metrics` (becomes `@mongodb-js/mcp-prom-metrics` in Task 9)
- Root `tsconfig.build.json` is the shared TypeScript base all packages extend

**Target `packages/` structure:**
```
packages/
├── mcp-api/               @mongodb-js/mcp-api          (interfaces only, devDep)
├── mcp-core/              @mongodb-js/mcp-core
├── mcp-atlas-api-client/  @mongodb-js/mcp-atlas-api-client
├── mcp-cli-logging/       @mongodb-js/mcp-cli-logging
├── mcp-cli-telemetry/     @mongodb-js/mcp-cli-telemetry
├── mcp-transports/        @mongodb-js/mcp-transports
├── mcp-prom-metrics/      @mongodb-js/mcp-prom-metrics  (rename of packages/metrics)
├── mcp-ui/                @mongodb-js/mcp-ui
├── mcp-tools-mongodb/     @mongodb-js/mcp-tools-mongodb
├── mcp-tools-atlas/       @mongodb-js/mcp-tools-atlas
├── mcp-tools-atlas-local/ @mongodb-js/mcp-tools-atlas-local
└── mcp-tools-assistant/   @mongodb-js/mcp-tools-assistant
```

**Dependency graph:**
```
mcp-api (no deps — interfaces only)
  ↑ devDep of everything below
mcp-core           depends on: mcp-api
mcp-atlas-api-client  depends on: mcp-api
mcp-transports     depends on: mcp-api
mcp-ui             depends on: mcp-api
mcp-tools-mongodb  depends on: mcp-api
mcp-tools-atlas    depends on: mcp-api, mcp-atlas-api-client
mcp-tools-atlas-local  depends on: mcp-api
mcp-tools-assistant   depends on: mcp-api
mcp-cli-logging    depends on: mcp-core
mcp-cli-telemetry  depends on: mcp-core, mcp-atlas-api-client
mcp-prom-metrics   depends on: (none, standalone — prom-client only)
mongodb-mcp-server (binary)  depends on: mcp-core, mcp-transports, mcp-ui, mcp-cli-logging,
                               mcp-cli-telemetry, mcp-prom-metrics,
                               mcp-tools-mongodb, mcp-tools-atlas,
                               mcp-tools-atlas-local, mcp-tools-assistant
```

**Cross-cutting refactoring (applied in each relevant task):**
Replace `TUserConfig` generics with explicit typed options. For example, a transport that currently takes `UserConfig` to read `port` and `ssl` should instead accept `{ port?: number; ssl?: boolean }`. The `UserConfig` Zod schema and parser stay in the binary package.

---

## Package Template

All new packages follow `packages/metrics` conventions:

**`package.json`** (adapt name, deps, description):
```json
{
  "name": "@mongodb-js/mcp-XXXX",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "...",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "devDependencies": {
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

**`tsconfig.json`** (same for all packages):
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

---

## Tasks

### Task 1: `@mongodb-js/mcp-api` — Interfaces Package

**Purpose:** Create a types-only package that defines the contracts between all other packages. No runtime code. Every other package lists this as a `devDependency` and uses `import type`.

**Source files to extract interfaces FROM:**
| Interface/Type | Extract from |
|---|---|
| `ISession` | `src/session.ts` |
| `ISessionStore` | `src/sessionStore.ts` |
| `IKeychain` | `src/keychain.ts` |
| `IElicitation` | `src/elicitation.ts` |
| `ToolBase`, `ToolClass`, `IToolRegistrar` | `src/tools/tool.ts` |
| `ILoggerBase`, `ICompositeLogger` | `src/common/logging/loggerBase.ts`, `compositeLogger.ts` |
| `LogLevel`, `LogId`, log event types | `src/common/logging/loggingTypes.ts` |
| `ITransportRunner`, `IServerFactory` | `src/transports/base.ts` |
| `ApiClientLike` | `src/common/atlas/apiClient.ts` |
| `IMetrics` | `packages/metrics/src/types.ts` |
| `IUIRegistry` | `src/ui/registry/registry.ts` |
| `IResources` | `src/resources/resources.ts` |
| `ITelemetry` | `src/telemetry/telemetry.ts` |
| `ConnectionOptions`, `DeviceId` helper types | `src/helpers/connectionOptions.ts`, `src/helpers/deviceId.ts` |
| Error code string literals / `ErrorCode` type | `src/common/errors.ts` |

**Files to create:**
```
packages/mcp-api/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          (re-exports everything)
    ├── session.ts        ISession
    ├── sessionStore.ts   ISessionStore
    ├── keychain.ts       IKeychain
    ├── elicitation.ts    IElicitation
    ├── logging.ts        ILoggerBase, ICompositeLogger, LogLevel, log event types
    ├── tool.ts           ToolBase (abstract), ToolClass, IToolRegistrar
    ├── transport.ts      ITransportRunner, IServerFactory
    ├── apiClient.ts      ApiClientLike
    ├── metrics.ts        IMetrics
    ├── ui.ts             IUIRegistry
    ├── resources.ts      IResources
    ├── telemetry.ts      ITelemetry
    ├── errors.ts         ErrorCode type / error code string literals
    └── helpers.ts        ConnectionOptions type, DeviceId type, shared helper types
```

- [ ] **Step 1: Create the package scaffold**

```bash
mkdir -p packages/mcp-api/src
```

Create `packages/mcp-api/package.json`:
```json
{
  "name": "@mongodb-js/mcp-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "TypeScript interfaces for the MongoDB MCP server packages",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "devDependencies": {
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Write the failing import test**

Create `packages/mcp-api/src/index.test.ts`:
```typescript
import type { ISession, ISessionStore, IKeychain, IElicitation } from "./index.js";
import type { ToolClass, IToolRegistrar } from "./index.js";
import type { ILoggerBase, ICompositeLogger } from "./index.js";
import type { ITransportRunner } from "./index.js";
import type { ApiClientLike, IMetrics, ITelemetry } from "./index.js";
import type { IUIRegistry, IResources } from "./index.js";

// This test just checks the barrel compiles — all types should be importable.
it("exports all interfaces", () => {
  expect(true).toBe(true);
});
```

- [ ] **Step 3: Run test — expect compile failure (index.ts doesn't exist yet)**

```bash
cd packages/mcp-api && pnpm compile 2>&1 | head -20
```

Expected: TypeScript error about missing files.

- [ ] **Step 4: Extract interfaces from source**

For each source file listed in the table above, read the file and extract only the interface/type definitions (not class implementations) into the corresponding `packages/mcp-api/src/*.ts` file.

**Pattern:** If `src/session.ts` exports `class Session { ... }` and the class has a public API, create `packages/mcp-api/src/session.ts` with:
```typescript
export interface ISession {
  // copy public method signatures from the Session class
}
```

If the source file already has a separate interface (common in TypeScript), copy that interface directly.

For `tool.ts`: `ToolClass` is likely `new (...args: any[]) => ToolBase`. Keep the abstract base definition as interface methods. Keep `ToolClass` as a type alias.

For `errors.ts`: extract only the type/string literal definitions, not `new Error(...)` calls.

- [ ] **Step 5: Create `packages/mcp-api/src/index.ts`**

```typescript
export type * from "./session.js";
export type * from "./sessionStore.js";
export type * from "./keychain.js";
export type * from "./elicitation.js";
export type * from "./logging.js";
export type * from "./tool.js";
export type * from "./transport.js";
export type * from "./apiClient.js";
export type * from "./metrics.js";
export type * from "./ui.js";
export type * from "./resources.js";
export type * from "./telemetry.js";
export type * from "./errors.js";
export type * from "./helpers.js";
```

- [ ] **Step 6: Build and run test**

```bash
cd packages/mcp-api && pnpm compile && pnpm test
```

Expected: compiles cleanly, test passes.

- [ ] **Step 7: Verify root build still passes**

```bash
cd /path/to/repo && pnpm run compile
```

Expected: no errors (existing `src/` is unchanged).

- [ ] **Step 8: Commit**

```bash
git add packages/mcp-api/
git commit -m "feat: add @mongodb-js/mcp-api interface package"
```

---

### Task 2: `@mongodb-js/mcp-core` — Core Implementations

**Purpose:** Move core runtime implementations out of `src/` into their own package. This is the first package with actual runtime code. It depends on `mcp-api` for interface types.

**Source files to MOVE (from `src/` to `packages/mcp-core/src/`):**

| Source | Destination |
|---|---|
| `src/session.ts` | `packages/mcp-core/src/session.ts` |
| `src/sessionStore.ts` | `packages/mcp-core/src/sessionStore.ts` |
| `src/keychain.ts` | `packages/mcp-core/src/keychain.ts` |
| `src/elicitation.ts` | `packages/mcp-core/src/elicitation.ts` |
| `src/common/logging/loggerBase.ts` | `packages/mcp-core/src/logging/loggerBase.ts` |
| `src/common/logging/mcpLogger.ts` | `packages/mcp-core/src/logging/mcpLogger.ts` |
| `src/common/logging/nullLogger.ts` | `packages/mcp-core/src/logging/noopLogger.ts` (rename) |
| `src/common/logging/compositeLogger.ts` | `packages/mcp-core/src/logging/compositeLogger.ts` |
| `src/common/logging/loggingTypes.ts` | `packages/mcp-core/src/logging/loggingTypes.ts` |
| `src/common/logging/loggingDefinitions.ts` | `packages/mcp-core/src/logging/loggingDefinitions.ts` |
| `src/transports/base.ts` | `packages/mcp-core/src/transport/base.ts` |
| `src/server.ts` | `packages/mcp-core/src/server.ts` |
| `src/resources/resource.ts` | `packages/mcp-core/src/resources/resource.ts` |
| `src/resources/resources.ts` | `packages/mcp-core/src/resources/resources.ts` |
| `src/helpers/container.ts` | `packages/mcp-core/src/helpers/container.ts` |
| `src/helpers/deviceId.ts` | `packages/mcp-core/src/helpers/deviceId.ts` |
| `src/helpers/connectionOptions.ts` | `packages/mcp-core/src/helpers/connectionOptions.ts` |
| `src/helpers/constants.ts` | `packages/mcp-core/src/helpers/constants.ts` |
| `src/helpers/managedTimeout.ts` | `packages/mcp-core/src/helpers/managedTimeout.ts` |
| `src/helpers/getRandomUUID.ts` | `packages/mcp-core/src/helpers/getRandomUUID.ts` |
| `src/common/errors.ts` | `packages/mcp-core/src/errors.ts` |
| `src/common/packageInfo.ts` | `packages/mcp-core/src/packageInfo.ts` |
| `src/telemetry/telemetry.ts` | `packages/mcp-core/src/telemetry/telemetry.ts` |
| `src/tools/tool.ts` | `packages/mcp-core/src/tools/tool.ts` |
| `src/tools/args.ts` | `packages/mcp-core/src/tools/args.ts` |

**Files to create:**
```
packages/mcp-core/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          (barrel — re-exports all public API)
    ├── session.ts
    ├── sessionStore.ts
    ├── keychain.ts
    ├── elicitation.ts
    ├── server.ts
    ├── errors.ts
    ├── packageInfo.ts
    ├── logging/
    │   ├── index.ts
    │   ├── loggerBase.ts
    │   ├── mcpLogger.ts
    │   ├── noopLogger.ts      (renamed from nullLogger)
    │   ├── compositeLogger.ts
    │   ├── loggingTypes.ts
    │   └── loggingDefinitions.ts
    ├── transport/
    │   ├── index.ts
    │   └── base.ts
    ├── resources/
    │   ├── index.ts
    │   ├── resource.ts
    │   └── resources.ts
    ├── telemetry/
    │   ├── index.ts
    │   └── telemetry.ts
    ├── tools/
    │   ├── index.ts
    │   ├── tool.ts
    │   └── args.ts
    └── helpers/
        ├── index.ts
        ├── container.ts
        ├── deviceId.ts
        ├── connectionOptions.ts
        ├── constants.ts
        ├── managedTimeout.ts
        └── getRandomUUID.ts
```

- [ ] **Step 1: Create the package scaffold**

```bash
mkdir -p packages/mcp-core/src/{logging,transport,resources,telemetry,tools,helpers}
```

Create `packages/mcp-core/package.json`:
```json
{
  "name": "@mongodb-js/mcp-core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Core runtime implementations for MongoDB MCP server packages",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "reflect-metadata": "^0.2.2",
    "tsyringe": "^4.10.0"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": ".",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move source files**

For each file in the move table above: copy from `src/` to `packages/mcp-core/src/`, then update all relative imports to either use `mcp-api` (for interface types) or the new relative paths within mcp-core.

Key import update pattern:
```typescript
// Before (inside src/):
import type { SomeInterface } from "../common/someInterface.js";

// After (inside packages/mcp-core/src/):
import type { ISession } from "@mongodb-js/mcp-api";
```

**Rename `NullLogger` → `NoopLogger`** when moving `nullLogger.ts` → `noopLogger.ts`.

**TUserConfig refactoring:** Anywhere a moved file accepts `TUserConfig` as a generic parameter or imports from `src/common/config/userConfig.ts`, replace with explicit typed options. For example:
```typescript
// Before:
class Session<TUserConfig> {
  constructor(config: TUserConfig) { ... }
}

// After:
export interface SessionOptions {
  connectionString?: string;
  // ... only the fields Session actually uses
}
class Session {
  constructor(options: SessionOptions) { ... }
}
```

- [ ] **Step 3: Create `packages/mcp-core/src/index.ts`** (barrel)

Export everything that other packages will need:
```typescript
export * from "./session.js";
export * from "./sessionStore.js";
export * from "./keychain.js";
export * from "./elicitation.js";
export * from "./server.js";
export * from "./errors.js";
export * from "./packageInfo.js";
export * from "./logging/index.js";
export * from "./transport/index.js";
export * from "./resources/index.js";
export * from "./telemetry/index.js";
export * from "./tools/index.js";
export * from "./helpers/index.js";
```

- [ ] **Step 4: Build mcp-core**

```bash
cd packages/mcp-core && pnpm compile 2>&1
```

Resolve all TypeScript errors before proceeding. Expected: clean compile.

- [ ] **Step 5: Run existing unit tests that cover moved code**

```bash
# From repo root:
pnpm vitest run tests/unit/logger.test.ts tests/unit/sessionStore.test.ts tests/unit/toolBase.test.ts
```

These tests should still reference the root `src/` (unchanged). All should pass. The moved packages are additive for now — `src/` still exists.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-core/
git commit -m "feat: add @mongodb-js/mcp-core package with core runtime implementations"
```

---

### Task 3: `@mongodb-js/mcp-atlas-api-client`

**Purpose:** Isolate the Atlas REST client so other packages don't need to bundle Atlas OpenAPI types and auth logic.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/common/atlas/apiClient.ts` | `packages/mcp-atlas-api-client/src/apiClient.ts` |
| `src/common/atlas/apiClientError.ts` | `packages/mcp-atlas-api-client/src/apiClientError.ts` |
| `src/common/atlas/auth/` (all files) | `packages/mcp-atlas-api-client/src/auth/` |
| `src/common/atlas/openapi.d.ts` | `packages/mcp-atlas-api-client/src/openapi.d.ts` |

**Refactoring:**
- `sendEvents()` (if it exists in apiClient) should accept generic `T[]` instead of a specific event type.
- `userAgent` string should be passed as a constructor/factory option rather than imported from `packageInfo`.

- [ ] **Step 1: Create scaffold**

```bash
mkdir -p packages/mcp-atlas-api-client/src/auth
```

Create `packages/mcp-atlas-api-client/package.json`:
```json
{
  "name": "@mongodb-js/mcp-atlas-api-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Atlas REST API client for MongoDB MCP server packages",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "openapi-fetch": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-atlas-api-client/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move files and update imports**

Copy files per the table above. Update internal imports to use relative paths. Remove any import of `UserConfig` or `packageInfo` — replace `userAgent` with an options parameter:

```typescript
// Before:
import { packageInfo } from "../packageInfo.js";
export function createApiClient(baseUrl: string) {
  return openApiFetch({ baseUrl, headers: { "User-Agent": packageInfo.version } });
}

// After:
export interface ApiClientOptions {
  userAgent: string;
}
export function createApiClient(baseUrl: string, options: ApiClientOptions) {
  return openApiFetch({ baseUrl, headers: { "User-Agent": options.userAgent } });
}
```

- [ ] **Step 3: Create `packages/mcp-atlas-api-client/src/index.ts`**

```typescript
export * from "./apiClient.js";
export * from "./apiClientError.js";
export * from "./auth/index.js";
// openapi.d.ts types are auto-included via TypeScript, no explicit re-export needed
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-atlas-api-client && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-atlas-api-client/
git commit -m "feat: add @mongodb-js/mcp-atlas-api-client package"
```

---

### Task 4: `@mongodb-js/mcp-cli-logging`

**Purpose:** Isolate CLI-specific loggers (console, disk) from packages that don't need them.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/common/logging/consoleLogger.ts` | `packages/mcp-cli-logging/src/consoleLogger.ts` |
| `src/common/logging/diskLogger.ts` | `packages/mcp-cli-logging/src/diskLogger.ts` |
| `src/common/logging/loggingDefinitions.ts` | `packages/mcp-cli-logging/src/loggingDefinitions.ts` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-cli-logging/src
```

Create `packages/mcp-cli-logging/package.json`:
```json
{
  "name": "@mongodb-js/mcp-cli-logging",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "CLI logger implementations (console, disk) for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "@mongodb-js/mcp-core": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-cli-logging/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move files, update imports to use `@mongodb-js/mcp-core`**

After moving, update imports like:
```typescript
// Before:
import { LoggerBase } from "../loggerBase.js";

// After:
import { LoggerBase } from "@mongodb-js/mcp-core";
```

- [ ] **Step 3: Create `packages/mcp-cli-logging/src/index.ts`**

```typescript
export * from "./consoleLogger.js";
export * from "./diskLogger.js";
export * from "./loggingDefinitions.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-cli-logging && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-cli-logging/
git commit -m "feat: add @mongodb-js/mcp-cli-logging package"
```

---

### Task 5: `@mongodb-js/mcp-cli-telemetry`

**Purpose:** Isolate telemetry event definitions and caching from packages that don't emit telemetry.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/telemetry/types.ts` | `packages/mcp-cli-telemetry/src/types.ts` |
| `src/telemetry/eventCache.ts` | `packages/mcp-cli-telemetry/src/eventCache.ts` |
| `src/telemetry/constants.ts` | `packages/mcp-cli-telemetry/src/constants.ts` |
| `src/telemetry/timer.ts` | `packages/mcp-cli-telemetry/src/timer.ts` |
| `src/common/atlas/cluster.ts` | `packages/mcp-cli-telemetry/src/cluster.ts` (or stays in atlas-api-client — check if it's telemetry-specific) |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-cli-telemetry/src
```

Create `packages/mcp-cli-telemetry/package.json`:
```json
{
  "name": "@mongodb-js/mcp-cli-telemetry",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Telemetry event definitions and caching for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "@mongodb-js/mcp-core": "workspace:*",
    "@mongodb-js/mcp-atlas-api-client": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-cli-telemetry/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move files, update imports**

Update `eventCache.ts` to import `Telemetry` base from `@mongodb-js/mcp-core`. Update types.ts to import `ApiClientLike` from `@mongodb-js/mcp-api`.

- [ ] **Step 3: Create `packages/mcp-cli-telemetry/src/index.ts`**

```typescript
export * from "./types.js";
export * from "./eventCache.js";
export * from "./constants.js";
export * from "./timer.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-cli-telemetry && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-cli-telemetry/
git commit -m "feat: add @mongodb-js/mcp-cli-telemetry package"
```

---

### Task 6: `@mongodb-js/mcp-transports`

**Purpose:** Isolate transport runners so library consumers that embed the MCP server can choose their transport without pulling in CLI dependencies.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/transports/stdio.ts` | `packages/mcp-transports/src/stdio.ts` |
| `src/transports/streamableHttp.ts` | `packages/mcp-transports/src/streamableHttp.ts` |
| `src/transports/expressBasedHttpServer.ts` | `packages/mcp-transports/src/expressBasedHttpServer.ts` |
| `src/transports/mcpHttpServer.ts` | `packages/mcp-transports/src/mcpHttpServer.ts` |
| `src/transports/monitoringServer.ts` | `packages/mcp-transports/src/monitoringServer.ts` |
| `src/transports/dryModeRunner.ts` | `packages/mcp-transports/src/dryModeRunner.ts` |
| `src/transports/inMemoryTransport.ts` | `packages/mcp-transports/src/inMemoryTransport.ts` |
| `src/transports/constants.ts` | `packages/mcp-transports/src/constants.ts` |
| `src/transports/jsonRpcErrorCodes.ts` | `packages/mcp-transports/src/jsonRpcErrorCodes.ts` |

**Refactoring:** Each runner's constructor/factory currently accepts `UserConfig`. Replace with an explicit options type. Read each runner to determine what `UserConfig` fields it actually uses, then define a minimal options interface:

```typescript
// Before (example for HTTP runner):
export class StreamableHttpRunner {
  constructor(config: UserConfig) {
    this.port = config.port ?? 3000;
    this.ssl = config.ssl ?? false;
  }
}

// After:
export interface StreamableHttpRunnerOptions {
  port?: number;
  ssl?: boolean;
  serverFactory: IServerFactory;
}
export class StreamableHttpRunner {
  constructor(options: StreamableHttpRunnerOptions) {
    this.port = options.port ?? 3000;
    this.ssl = options.ssl ?? false;
  }
}
```

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-transports/src
```

Create `packages/mcp-transports/package.json`:
```json
{
  "name": "@mongodb-js/mcp-transports",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Transport runners (stdio, HTTP, in-memory) for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "workspace:*",
    "express": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@mongodb-js/mcp-core": "workspace:*",
    "@types/express": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-transports/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move files, apply UserConfig → typed options refactoring**

For each transport file, identify which `UserConfig` fields it reads and define a minimal `*Options` interface at the top of the file.

- [ ] **Step 3: Create `packages/mcp-transports/src/index.ts`**

```typescript
export * from "./stdio.js";
export * from "./streamableHttp.js";
export * from "./mcpHttpServer.js";
export * from "./monitoringServer.js";
export * from "./dryModeRunner.js";
export * from "./inMemoryTransport.js";
export * from "./constants.js";
export * from "./jsonRpcErrorCodes.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-transports && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-transports/
git commit -m "feat: add @mongodb-js/mcp-transports package with typed options API"
```

---

### Task 7: `@mongodb-js/mcp-prom-metrics` (rename `packages/metrics`)

**Purpose:** Rename the existing `@mongodb-js/mcp-metrics` package to `@mongodb-js/mcp-prom-metrics` to match the monorepo naming convention.

**Files to modify:**
- `packages/metrics/package.json` — update `name` field
- Root `package.json` — update workspace dependency name
- Any `src/` file that imports `@mongodb-js/mcp-metrics`

- [ ] **Step 1: Rename package directory**

```bash
mv packages/metrics packages/mcp-prom-metrics
```

- [ ] **Step 2: Update `packages/mcp-prom-metrics/package.json`**

Change `"name": "@mongodb-js/mcp-metrics"` to `"name": "@mongodb-js/mcp-prom-metrics"`.

- [ ] **Step 3: Find and update all import references**

```bash
grep -r "@mongodb-js/mcp-metrics" --include="*.ts" --include="*.json" -l
```

For each file found, replace `@mongodb-js/mcp-metrics` with `@mongodb-js/mcp-prom-metrics`.

- [ ] **Step 4: Run `pnpm install` to update lockfile**

```bash
pnpm install
```

- [ ] **Step 5: Build and test the renamed package**

```bash
cd packages/mcp-prom-metrics && pnpm compile && pnpm test
```

Expected: clean compile and passing tests.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-prom-metrics/ packages/metrics
git commit -m "chore: rename @mongodb-js/mcp-metrics to @mongodb-js/mcp-prom-metrics"
```

---

### Task 8: `@mongodb-js/mcp-ui`

**Purpose:** Isolate the React UI components so Compass and other non-CLI consumers can opt into them.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/ui/registry/registry.ts` | `packages/mcp-ui/src/registry/registry.ts` |
| `src/ui/registry/index.ts` | `packages/mcp-ui/src/registry/index.ts` |
| `src/ui/components/` (all files) | `packages/mcp-ui/src/components/` |
| `src/ui/lib/loaders.ts` | `packages/mcp-ui/src/lib/loaders.ts` |
| `src/ui/lib/tools/` (all files) | `packages/mcp-ui/src/lib/tools/` |
| `src/ui/build/mount.tsx` | `packages/mcp-ui/src/build/mount.tsx` |
| `src/ui/build/template.html` | `packages/mcp-ui/src/build/template.html` |
| `src/ui/styles/fonts.css` | `packages/mcp-ui/src/styles/fonts.css` |
| `src/ui/index.ts` | `packages/mcp-ui/src/index.ts` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-ui/src/{registry,components,lib/tools,build,styles}
```

Create `packages/mcp-ui/package.json`:
```json
{
  "name": "@mongodb-js/mcp-ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "React UI components for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@types/node": "workspace:*",
    "@types/react": "workspace:*",
    "react": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.build.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "baseUrl": ".",
    "jsx": "react-jsx"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
  "exclude": ["dist", "node_modules", "src/**/*.test.ts"]
}
```

- [ ] **Step 2: Move files, update imports**

Update `IUIRegistry` imports to come from `@mongodb-js/mcp-api`.

- [ ] **Step 3: Build and verify**

```bash
cd packages/mcp-ui && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-ui/
git commit -m "feat: add @mongodb-js/mcp-ui package"
```

---

### Task 9: `@mongodb-js/mcp-tools-mongodb`

**Purpose:** Extract MongoDB CRUD/query tools into a standalone package that only depends on the MongoDB driver and `mcp-api`.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/tools/mongodb/mongodbTool.ts` | `packages/mcp-tools-mongodb/src/mongodbTool.ts` |
| `src/tools/mongodb/mongodbSchemas.ts` | `packages/mcp-tools-mongodb/src/mongodbSchemas.ts` |
| `src/tools/mongodb/tools.ts` | `packages/mcp-tools-mongodb/src/tools.ts` |
| `src/tools/mongodb/connect/` | `packages/mcp-tools-mongodb/src/connect/` |
| `src/tools/mongodb/read/` | `packages/mcp-tools-mongodb/src/read/` |
| `src/tools/mongodb/create/` | `packages/mcp-tools-mongodb/src/create/` |
| `src/tools/mongodb/update/` | `packages/mcp-tools-mongodb/src/update/` |
| `src/tools/mongodb/delete/` | `packages/mcp-tools-mongodb/src/delete/` |
| `src/tools/mongodb/metadata/` | `packages/mcp-tools-mongodb/src/metadata/` |
| `src/common/connectionManager.ts` | `packages/mcp-tools-mongodb/src/connectionManager.ts` |
| `src/common/connectionInfo.ts` | `packages/mcp-tools-mongodb/src/connectionInfo.ts` |
| `src/common/connectionErrorHandler.ts` | `packages/mcp-tools-mongodb/src/connectionErrorHandler.ts` |
| `src/common/schemas.ts` | `packages/mcp-tools-mongodb/src/schemas.ts` |
| `src/helpers/collectCursorUntilMaxBytes.ts` | `packages/mcp-tools-mongodb/src/helpers/collectCursorUntilMaxBytes.ts` |
| `src/helpers/indexCheck.ts` | `packages/mcp-tools-mongodb/src/helpers/indexCheck.ts` |
| `src/helpers/assertVectorSearchFilterFieldsAreIndexed.ts` | `packages/mcp-tools-mongodb/src/helpers/assertVectorSearchFilterFieldsAreIndexed.ts` |
| `src/helpers/operationWithFallback.ts` | `packages/mcp-tools-mongodb/src/helpers/operationWithFallback.ts` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-tools-mongodb/src/{connect,read,create,update,delete,metadata,helpers}
```

Create `packages/mcp-tools-mongodb/package.json`:
```json
{
  "name": "@mongodb-js/mcp-tools-mongodb",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "MongoDB CRUD and query tools for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "mongodb": "workspace:*",
    "bson": "workspace:*",
    "zod": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@mongodb-js/mcp-core": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-tools-mongodb/tsconfig.json` (same pattern as other packages).

- [ ] **Step 2: Move files, update imports**

Base tool imports should come from `@mongodb-js/mcp-core` (for `ToolBase`, `ToolClass`) and `@mongodb-js/mcp-api` for interface types.

- [ ] **Step 3: Create `packages/mcp-tools-mongodb/src/index.ts`**

```typescript
export * from "./mongodbTool.js";
export * from "./connectionManager.js";
export * from "./connectionInfo.js";
export { MongoDBTools } from "./tools.js";
export type { ToolClass } from "@mongodb-js/mcp-api";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-tools-mongodb && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Run relevant unit tests**

```bash
cd /repo-root && pnpm vitest run tests/unit/toolBase.test.ts tests/unit/args.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-tools-mongodb/
git commit -m "feat: add @mongodb-js/mcp-tools-mongodb package"
```

---

### Task 10: `@mongodb-js/mcp-tools-atlas`

**Purpose:** Extract Atlas management tools into a standalone package.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/tools/atlas/atlasTool.ts` | `packages/mcp-tools-atlas/src/atlasTool.ts` |
| `src/tools/atlas/tools.ts` | `packages/mcp-tools-atlas/src/tools.ts` |
| `src/tools/atlas/connect/` | `packages/mcp-tools-atlas/src/connect/` |
| `src/tools/atlas/create/` | `packages/mcp-tools-atlas/src/create/` |
| `src/tools/atlas/read/` | `packages/mcp-tools-atlas/src/read/` |
| `src/tools/atlas/streams/` | `packages/mcp-tools-atlas/src/streams/` |
| `src/common/atlas/cluster.ts` | `packages/mcp-tools-atlas/src/cluster.ts` |
| `src/common/atlas/performanceAdvisorUtils.ts` | `packages/mcp-tools-atlas/src/performanceAdvisorUtils.ts` |
| `src/common/atlas/accessListUtils.ts` | `packages/mcp-tools-atlas/src/accessListUtils.ts` |
| `src/common/atlas/roles.ts` | `packages/mcp-tools-atlas/src/roles.ts` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-tools-atlas/src/{connect,create,read,streams}
```

Create `packages/mcp-tools-atlas/package.json`:
```json
{
  "name": "@mongodb-js/mcp-tools-atlas",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Atlas management tools for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "dependencies": {
    "@mongodb-js/mcp-atlas-api-client": "workspace:*"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@mongodb-js/mcp-core": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-tools-atlas/tsconfig.json` (same pattern as other packages).

- [ ] **Step 2: Move files, update imports**

Atlas tool base imports `ApiClientLike` from `@mongodb-js/mcp-api`. Auth and API client come from `@mongodb-js/mcp-atlas-api-client`.

- [ ] **Step 3: Create `packages/mcp-tools-atlas/src/index.ts`**

```typescript
export * from "./atlasTool.js";
export { AtlasTools } from "./tools.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-tools-atlas && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-tools-atlas/
git commit -m "feat: add @mongodb-js/mcp-tools-atlas package"
```

---

### Task 11: `@mongodb-js/mcp-tools-atlas-local`

**Purpose:** Extract Atlas Local tools, including the dynamic loader for `@mongodb-js/atlas-local` and Docker detection.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/common/atlasLocal.ts` | `packages/mcp-tools-atlas-local/src/atlasLocalClient.ts` |
| `src/tools/atlasLocal/atlasLocalTool.ts` | `packages/mcp-tools-atlas-local/src/atlasLocalTool.ts` |
| `src/tools/atlasLocal/tools.ts` | `packages/mcp-tools-atlas-local/src/tools.ts` |
| `src/tools/atlasLocal/connect/` | `packages/mcp-tools-atlas-local/src/connect/` |
| `src/tools/atlasLocal/create/` | `packages/mcp-tools-atlas-local/src/create/` |
| `src/tools/atlasLocal/delete/` | `packages/mcp-tools-atlas-local/src/delete/` |
| `src/tools/atlasLocal/read/` | `packages/mcp-tools-atlas-local/src/read/` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-tools-atlas-local/src/{connect,create,delete,read}
```

Create `packages/mcp-tools-atlas-local/package.json`:
```json
{
  "name": "@mongodb-js/mcp-tools-atlas-local",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Atlas Local deployment tools for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "peerDependencies": {
    "@mongodb-js/atlas-local": "^1.0.0"
  },
  "peerDependenciesMeta": {
    "@mongodb-js/atlas-local": { "optional": true }
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@mongodb-js/mcp-core": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-tools-atlas-local/tsconfig.json` (same pattern as other packages).

- [ ] **Step 2: Move files, update imports**

The dynamic loader for `@mongodb-js/atlas-local` uses `import()` — keep that pattern.

- [ ] **Step 3: Create `packages/mcp-tools-atlas-local/src/index.ts`**

```typescript
export * from "./atlasLocalTool.js";
export { AtlasLocalTools } from "./tools.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-tools-atlas-local && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-tools-atlas-local/
git commit -m "feat: add @mongodb-js/mcp-tools-atlas-local package"
```

---

### Task 12: `@mongodb-js/mcp-tools-assistant`

**Purpose:** Extract AI assistant tools (knowledge search) into a standalone package.

**Source files to MOVE:**

| Source | Destination |
|---|---|
| `src/tools/assistant/assistantTool.ts` | `packages/mcp-tools-assistant/src/assistantTool.ts` |
| `src/tools/assistant/listKnowledgeSources.ts` | `packages/mcp-tools-assistant/src/listKnowledgeSources.ts` |
| `src/tools/assistant/searchKnowledge.ts` | `packages/mcp-tools-assistant/src/searchKnowledge.ts` |
| `src/tools/assistant/tools.ts` | `packages/mcp-tools-assistant/src/tools.ts` |

- [ ] **Step 1: Create scaffold and `package.json`**

```bash
mkdir -p packages/mcp-tools-assistant/src
```

Create `packages/mcp-tools-assistant/package.json`:
```json
{
  "name": "@mongodb-js/mcp-tools-assistant",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "AI assistant tools for MongoDB MCP server",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "compile": "tsc --project tsconfig.json",
    "test": "vitest --run"
  },
  "devDependencies": {
    "@mongodb-js/mcp-api": "workspace:*",
    "@mongodb-js/mcp-core": "workspace:*",
    "@types/node": "workspace:*",
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
```

Create `packages/mcp-tools-assistant/tsconfig.json` (same pattern as other packages).

- [ ] **Step 2: Move files, update imports**

`assistantTool.ts` likely takes an `assistantBaseUrl` string — keep it as an explicit option, not from UserConfig.

- [ ] **Step 3: Create `packages/mcp-tools-assistant/src/index.ts`**

```typescript
export * from "./assistantTool.js";
export { AssistantTools } from "./tools.js";
```

- [ ] **Step 4: Build and verify**

```bash
cd packages/mcp-tools-assistant && pnpm compile 2>&1
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-tools-assistant/
git commit -m "feat: add @mongodb-js/mcp-tools-assistant package"
```

---

### Task 13: Binary Package — Wire Up `mongodb-mcp-server`

**Purpose:** Update the root `src/` (the binary) to import from packages instead of its own moved files. This is the integration step. After this task, the full build should pass.

**Files to update in `src/`:**
- `src/index.ts` — update tool/transport imports to use packages
- `src/common/config/userConfig.ts` — stays here, no change
- `src/common/config/parseUserConfig.ts` — stays here, no change
- `src/setup/setupMcpServer.ts` — stays here; update any imports that moved
- `src/lib.ts`, `src/web.ts` — update re-exports to point at packages

**Files to DELETE from `src/`** (once their package counterparts exist and the binary compiles):
- All files that were moved to packages (listed in Tasks 1–12)
- Only delete a file AFTER confirming the binary compiles without it

- [ ] **Step 1: Add package dependencies to root `package.json`**

In the root `package.json` `dependencies`, add:
```json
"@mongodb-js/mcp-core": "workspace:*",
"@mongodb-js/mcp-atlas-api-client": "workspace:*",
"@mongodb-js/mcp-cli-logging": "workspace:*",
"@mongodb-js/mcp-cli-telemetry": "workspace:*",
"@mongodb-js/mcp-transports": "workspace:*",
"@mongodb-js/mcp-prom-metrics": "workspace:*",
"@mongodb-js/mcp-ui": "workspace:*",
"@mongodb-js/mcp-tools-mongodb": "workspace:*",
"@mongodb-js/mcp-tools-atlas": "workspace:*",
"@mongodb-js/mcp-tools-atlas-local": "workspace:*",
"@mongodb-js/mcp-tools-assistant": "workspace:*"
```

Add `@mongodb-js/mcp-api` to `devDependencies`.

Then run:
```bash
pnpm install
```

- [ ] **Step 2: Update `src/index.ts` imports**

Replace imports from internal paths that have moved to packages. Example:
```typescript
// Before:
import { StdioRunner } from "./transports/stdio.js";
import { MongoDBTools } from "./tools/mongodb/tools.js";

// After:
import { StdioRunner } from "@mongodb-js/mcp-transports";
import { MongoDBTools } from "@mongodb-js/mcp-tools-mongodb";
```

Follow this pattern for every import that points to a file moved to a package.

- [ ] **Step 3: Update `src/lib.ts` and `src/web.ts`**

These files re-export the public API. Update them to re-export from packages:
```typescript
// src/lib.ts
export * from "@mongodb-js/mcp-core";
export * from "@mongodb-js/mcp-tools-mongodb";
export * from "@mongodb-js/mcp-transports";
// etc.
```

- [ ] **Step 4: Attempt full build**

```bash
pnpm run compile 2>&1
```

Fix any remaining import errors. Repeat until clean.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test 2>&1
```

Fix any test import failures. Expected: same pass rate as before the migration.

- [ ] **Step 6: Remove deleted source files**

Once the build and tests pass, delete files from `src/` that have been fully replaced by packages. Do this incrementally — delete one group, re-run build, confirm clean, then continue.

```bash
# Example: once transports package is wired up and build passes:
rm -rf src/transports/
pnpm run compile  # confirm still passes
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire binary package to use @mongodb-js/* workspace packages"
```

---

### Task 14: Tests Migration & Cleanup

**Purpose:** Move unit tests that belong to specific packages into those packages. Keep integration and accuracy tests at the root.

**Mapping:**

| Existing test | Move to |
|---|---|
| `tests/unit/logger.test.ts` | `packages/mcp-cli-logging/src/` |
| `tests/unit/sessionStore.test.ts` | `packages/mcp-core/src/` |
| `tests/unit/toolBase.test.ts` | `packages/mcp-core/src/` |
| `tests/unit/eventCache.test.ts` | `packages/mcp-cli-telemetry/src/` |
| `tests/unit/args.test.ts` | `packages/mcp-core/src/` |
| `tests/unit/accessListUtils.test.ts` | `packages/mcp-tools-atlas/src/` |
| `tests/unit/telemetry.test.ts` | `packages/mcp-cli-telemetry/src/` |
| All `tests/integration/` | Stay at root (tests the full binary) |
| All `tests/accuracy/` | Stay at root (end-to-end) |

- [ ] **Step 1: Move unit test files**

For each test in the table, copy it to the target package's `src/` directory. Update imports to use the package's local paths.

- [ ] **Step 2: Run each package's tests**

```bash
# For each package:
cd packages/mcp-core && pnpm test
cd packages/mcp-cli-logging && pnpm test
# etc.
```

Expected: all pass.

- [ ] **Step 3: Confirm root integration tests still pass**

```bash
cd /repo-root && pnpm vitest run tests/integration/
```

Expected: same pass rate as before.

- [ ] **Step 4: Update root `vitest.config.ts`**

Remove the `unit-and-integration` project's coverage of files that have moved to packages. Add a `packages/*` sweep or adjust includes.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: migrate unit tests to their respective packages"
```

---

### Task 15: CI/CD & Build Infrastructure

**Purpose:** Update CI scripts, API report generation, and publish config to account for the new packages.

- [ ] **Step 1: Update root `package.json` `build` script**

Confirm `pnpm run -r --include-workspace-root compile` covers all new packages (it should automatically via `packages/*`).

```bash
pnpm run build 2>&1
```

Expected: all 13 packages + root compile in parallel.

- [ ] **Step 2: Update API report (if applicable)**

```bash
pnpm run generate 2>&1
```

Fix any API extractor config that references moved files.

- [ ] **Step 3: Update `knip.json` for unused dependency checks**

Add `packages/*/package.json` to knip's workspaces config so it checks each package independently.

- [ ] **Step 4: Verify `pnpm run check` passes**

```bash
pnpm run check 2>&1
```

Expected: lint, types, format, dependencies all pass.

- [ ] **Step 5: Update publish config**

For any packages that should be published (not `private: true`), ensure:
- `publishConfig.access: "public"`
- `repository.directory` points to the package subdirectory
- `files: ["dist"]` is set

The `mongodb-mcp-server` binary and any publicly-exported `@mongodb-js/mcp-*` packages should be public. Internal-only packages stay `private: true`.

- [ ] **Step 6: Final integration test run**

```bash
pnpm test 2>&1
```

Expected: full suite passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: update CI and build config for monorepo packages"
```

---

## Status Tracking

| Task | Package | Status |
|---|---|---|
| Task 1 | `@mongodb-js/mcp-api` | [ ] Not started |
| Task 2 | `@mongodb-js/mcp-core` | [ ] Not started |
| Task 3 | `@mongodb-js/mcp-atlas-api-client` | [ ] Not started |
| Task 4 | `@mongodb-js/mcp-cli-logging` | [ ] Not started |
| Task 5 | `@mongodb-js/mcp-cli-telemetry` | [ ] Not started |
| Task 6 | `@mongodb-js/mcp-transports` | [ ] Not started |
| Task 7 | `@mongodb-js/mcp-prom-metrics` | [ ] Not started |
| Task 8 | `@mongodb-js/mcp-ui` | [ ] Not started |
| Task 9 | `@mongodb-js/mcp-tools-mongodb` | [ ] Not started |
| Task 10 | `@mongodb-js/mcp-tools-atlas` | [ ] Not started |
| Task 11 | `@mongodb-js/mcp-tools-atlas-local` | [ ] Not started |
| Task 12 | `@mongodb-js/mcp-tools-assistant` | [ ] Not started |
| Task 13 | Binary wire-up | [ ] Not started |
| Task 14 | Tests migration | [ ] Not started |
| Task 15 | CI/CD | [ ] Not started |
