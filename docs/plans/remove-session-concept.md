# Plan: Remove "Session" as a Concept from the MCP Server

> Branch: `refactor/remove-session-concept` (based on `chore/protocol-revision-2026-07-28`)
> Status: **Plan only — no implementation yet.**

## 1. Goal

Make the server treat every tool call as **request-scoped**, backed by **app-level shared
services** (connection store, keychain, Atlas API client, exports). Remove the per-client
"session" object as a first-class concept; keep per-client negotiated state (identity,
capabilities) as **request metadata** rather than a mutable server-side session.

Target end state:

- One server process; no per-client server/session instances held in memory.
- A tool's behavior is fully determined by: the request (args, headers, `_meta`), the
  static `UserConfig`, and app-level shared services. No implicit per-client state.
- Per-client data (MongoDB connections created by the client, its exports directory,
  its identity for `appName`/telemetry) is either **explicitly keyed** (by
  `connectionId` / client identity) or **request-carried** (from negotiated state).

## 2. Current state (why this is feasible)

Exploration of the codebase shows the tool layer is already ~90% de-sessioned:

- **`Session` (`packages/cli/src/cliSession.ts`)** is a thin, mostly-immutable context
  bag: `logger`, `config`, `keychain` (already a process-global singleton),
  `connectionRegistry` (a scoped _view_ over the app-level `MCPConnectionStore`),
  `apiClient`, `atlasLocalClient`, `exportsManager`, `mcpClient`. Its docstring already
  states connection state is _not_ session-scoped.
- **MongoDB connections** are already keyed by opaque `connectionId` in the app-level
  `MCPConnectionStore` (`packages/tools-mongodb/src/common/connectionStore.ts`). The
  only session tie is the optional `scope` tag on entries.
- **Tools** receive the session at construction but only use: `logger`, `config`,
  `keychain`, `connectionRegistry`, `apiClient`, `atlasLocalClient`, `exportsManager`,
  `connectionErrorHandler`, `mcpClient`. No tool reads `sessionId`,
  `isConnectedToMongoDB`, `connectionStringInfo`, `connectedAtlasCluster`, or calls
  `session.disconnect()`.
- **Telemetry** never populates `session_id` (property exists in types, always unset).
- **HTTP is already dual-path** (`packages/http-runners/src/mcpHttpServer.ts`):
  - _Legacy (2025-era)_: sessionful — `SessionStore`, `mcp-session-id` header, one
    server+transport per session, idle/notification timers, LRU eviction.
  - _Modern (2026-07-28)_: already per-request — `createServerForRequest()` builds a
    fresh `CliServer` per request.

So the project is mostly **deleting the legacy sessionful path, flattening the per-client
context bag into app-level services + request context, and closing the functional gaps
the per-request path currently has.**

## 3. Current gaps in the per-request (modern) path

These are what "removing sessions" actually has to solve:

1. **Connections don't survive across requests.** Each request builds a fresh
   `CliServer` → fresh registry view scoped to a random UUID (when
   `connectionScope: "session"`, the default). A `connect` in request N is invisible to
   request N+1. Only `connectionScope: "global"` works today.
2. **Per-request server construction is expensive and wasteful**: fresh `McpServer`,
   fresh `CompositeLogger`, fresh `AtlasTelemetry`, fresh exports directory (each request
   mints a new `ObjectId` exports dir), fresh `Elicitation`.
3. **Exports directory lifecycle is tied to `Session.close()`**; with a per-request
   server this either leaks per-request dirs or deletes exports the client might still
   be downloading on a subsequent request.
4. **Negotiated client state** (client info + capabilities from `initialize`) lives on
   the per-request `McpServer` and is lost between requests; the legacy path compensates
   via `NegotiatedClientState` in the `SessionStore`.
5. **Lifecycle ownership**: `Session.close()` currently owns teardown ordering
   (registry → API client → exports). Once sessions go, lifecycle must move to
   process-level shutdown and per-request cleanup.

## 4. Proposed target architecture

```
App-level (built once at startup, shared, immutable config):
  UserConfig, Metrics, CompositeLogger (root), Keychain (root),
  MCPConnectionStore, ApiClient, ExportsManager (app-rooted),
  AtlasLocalClient, DeviceId, MonitoringServer, Elicitation factory,
  a single McpServer (+ CliServer facade) with tools registered once.

Request-scoped (derived per request, never stored):
  ToolRequest (carried as ToolExecutionContext.request):
    { config (effective, request-overridden), raw (SDK mcpReq), signal, id,
      headers, _meta, sendNotification, inputResponses, clientInfo,
      elicitationDurationMs }                                   (landed)
  + client-scoped ConnectionRegistry view (keyed by client identity)
```

Concretely:

- **Rename/replace `Session` → `AppContext` / `ServerServices`**: same fields minus
  `sessionId`, `mcpClient`, `setMcpClient`, the event emitter, and all dead members.
  Tools keep receiving it at construction; nothing about tool signatures changes.
- **`mcpClient` moves to `ToolExecutionContext.request`**: tools that use it
  (`connect`, `atlas-connect-cluster`, `atlas-local-connect-deployment`) read it from
  the request object instead of the session.
- **Connection scoping by client identity, not session**: replace the random
  `getRandomUUID()` scope with a **stable, client-supplied identity** (see §5 decision
  point), or drop scoping entirely and make `connectionScope: "global"` the only mode.
- **Exports**: app-level `ExportsManager` keyed by client identity or TTL-based expiry
  instead of `Session.close()`.
- **HTTP transport**: single stateless handler — the modern path becomes the _only_
  path. `SessionStore`, `mcp-session-id` routing, `NegotiatedClientState` persistence,
  idle/notification timers, `maxSessions`/`idleTimeoutMs`/`notificationTimeoutMs`/
  `externallyManagedSessions` config all get deleted.

## 5. Migration phases (implementation order)

### Phase 0 — Delete dead session surface (pure cleanup, no behavior change)

- `ISession` (`packages/types/src/session.ts`): remove `disconnect()`,
  `isConnectedToMongoDB`, `connectionStringInfo`, `connectedAtlasCluster`,
  `SessionEvents` (connect/disconnect/connection-error), `sessionId`.
- `IAtlasSession` / `IAtlasLocalSession`: remove `connectToMongoDB`,
  `connectionManager`, `connectedAtlasCluster` leftovers.
- `ReactiveResource` session-event subscription (`packages/core/src/reactiveResource.ts`)
  — no shipped resource subscribes (`events: []` everywhere).
- `TelemetryCommonProperties.session_id` (never populated).
- `Session.sessionId` (ObjectId) — only integration tests assert its shape.

### Phase 1 — Session → ServerServices rename + move `mcpClient` to request context

- Rename `Session` → `ServerServices` (or `AppContext`); drop `EventEmitter`, `close()`
  semantics move to process shutdown (`cliStdioRunner` / runner `stop()`).
- **Done — request-centric tool context**: `ToolExecutionContext` is now an envelope
  carrying a single `request` field (`ToolRequest`), which holds every piece of
  request-derived data: effective (possibly request-overridden) `config`, `raw`
  (the SDK `mcpReq` the request was built around), `signal`, `id`, `headers`
  (flattened from the old `requestInfo.headers`), `_meta`, `inputResponses`,
  `sendNotification`, `clientInfo`, `elicitationDurationMs`. `ApiClientRequestContext`
  mirrors the flattening (`headers` at top level) so a `ToolRequest` is passed
  straight to Atlas API calls. Tools read `request.config` instead of
  `this.server.config` at execute time; registration-time config reads
  (`verifyAllowed`, `toolMeta`, description, `schemaVariantKey`, argShape) stay on
  `server.config`.
- Update the 3 tools that read `session.mcpClient` to read from the context.
- Update `IToolSession` doc/types accordingly (it already only requires
  `config`/`logger`/`keychain`).

### Phase 2 — App-level services construction

- Collapse `createSharedServicesFromConfig` + `createServerFromConfig`
  (`packages/cli/src/createServerServices.ts`) into a single `createAppServices(config)`
  built once at startup.
- Build `McpServer`, `CompositeLogger`, `AtlasTelemetry`, `Elicitation`, `ExportsManager`
  **once**; register tools once.
- Stdio runner: already one server per process — minimal change.
- HTTP: `createServerForRequest` stops building servers per request; instead it only
  applies config overrides (headers/query) into a **request-scoped effective config**
  and resolves the client-scoped registry view.

> Note: per-request config overrides currently produce a _new server_ because tools bake
> `config` at construction. Decide: either (a) make tool config access request-aware
> (read effective config from the execution context), or (b) restrict HTTP overrides to
> only affect request-safe fields. This is the trickiest structural change in Phase 2 —
> see Limitations.

### Phase 3 — Connection ownership without sessions (decision required)

Options (pick one — recommend **A**):

- **A. Client-identity scoping**: require clients to identify themselves (existing
  mechanisms: `mcpClient.name` from `initialize`, or an `x-mongodb-mcp-*` header).
  Registry scope = stable hash of identity instead of random UUID. Connections then
  survive across requests per client, preserving the current `connectionScope:
"session"` security semantics (multi-tenant HTTP deployments) without server-side
  session objects.

> **Done — 3A implemented** (`feat(cli): per-client connection scoping over HTTP`):
> every HTTP request gets an isolated `view({ scope, owned: true })` over the app-level
> `MCPConnectionStore`. Identified clients (`x-mcp-client-name` header — outside the
> `x-mongodb-mcp-` config-override prefix) get a stable scope: connections survive
> across that client's requests while staying invisible to other clients. Anonymous
> HTTP requests get an ephemeral per-request scope (no cross-request state, and they
> can never see identified clients' connections). No-request paths (stdio, dry-run,
> eval) keep the app-level registry. The scope is the raw trimmed header value, not a
> hash — the store key never leaves the process.
- **B. Global-only**: delete `connectionScope: "session"`; all runtime connections are
  shared. Simplest, but changes the documented security posture for unauthenticated
  multi-client HTTP deployments (any client can see/use any connectionId).
- **C. Request-carried connection ids**: client passes `connectionId`s it owns each
  call; server treats the store as global but unguessable UUIDs act as capability
  tokens. Functionally close to B.

### Phase 4 — Exports without session lifecycle

- `ExportsManager` rooted app-level; directory per client identity (Phase 3 key) or per
  export with TTL/expiry sweep; delete `Session.close()`-driven cleanup.

### Phase 5 — Remove the legacy sessionful HTTP path

- Delete `SessionStore` (`packages/core/src/sessionStore.ts`),
  `ISessionStore`/`SessionStoreConstructorArgs` (`packages/types/src/sessionStore.ts`),
  `NegotiatedClientState` save/load, the `ensureSessionInitialized` /
  `mcp-session-id` routing in `mcpHttpServer.ts`, `NodeStreamableHTTPServerTransport`
  legacy wiring, and the session JSON-RPC error codes.
- Delete config: `maxSessions`, `idleTimeoutMs`, `notificationTimeoutMs`,
  `externallyManagedSessions` (and their config-override registrations).
- Delete/adjust metrics: `mcp_session_created`, `mcp_session_closed`,
  `mcp_active_sessions` (replace with request-level metrics if useful).
- Stdio runner simplification falls out naturally (no per-connection session either).

### Phase 6 — Negotiated client state, statelessly

- The client sends `initialize`-era info per request (2026-07-28 protocol behavior), so
  `ClientContext` is populated from the request envelope rather than a persisted store.
- `Elicitation` reads capabilities from the request context instead of a bound
  `McpServer` instance.

### Phase 7 — Tests, docs, leftovers

- Update integration tests asserting `sessionId` shape / session metrics / session
  close logs; update `LogId` session entries; sweep `session` wording in
  `MCP_SERVER_LIBRARY.md`, README, config descriptions.

## 6. Limitations & trade-offs of this approach

1. **Protocol-era compatibility**: removing the legacy sessionful path drops support for
   pre-2026 MCP clients over HTTP that rely on `mcp-session-id` and server-held
   transports. Mitigation: stdio clients unaffected; HTTP clients must speak the modern
   stateless protocol. (Alternatively keep the legacy path while de-sessioning tools —
   halves the benefit.)
2. **Cross-request MongoDB connections require _some_ keyed store.** A truly stateless
   server cannot let a client `connect` in one request and query in the next unless the
   connection store is app-level and addressable. We keep `connectionId` keying
   (already the design), but scoping now needs a **stable client identity** — which is
   itself a lightweight form of state (a lookup key, though not a server-side session
   object). If no identity is available, the fallback is global/shared connections
   (security posture change, §5 Phase 3B).
3. **Per-request config overrides vs. shared server instance**: execute-time config
   reads now travel on the request (`request.config`), so a shared server no longer
   needs rebuilding per request for those. Registration-time reads (`verifyAllowed`,
   `toolMeta`, tool `description`, `schemaVariantKey`) still consume `server.config`
   and remain base-config-bound until the request-aware registration is designed
   (tool enablement flags like `disabledTools`/read-only would have to be enforced at
   invoke time on a shared instance).
4. **Performance reality check**: the current modern path is _worse_ than stateless —
   it rebuilds the entire server per request (telemetry clients, exports dirs, logger).
   The plan fixes this, but until Phase 2 lands, HTTP-per-request is expensive.
5. **Exports lifecycle**: without `Session.close()`, cleanup needs TTL/expiry or
   client-keyed ownership; stale export cleanup becomes the server's responsibility.
6. **Elicitation multi-round-trip flows** depend on client capabilities negotiated per
   connection; in a stateless model every elicitation round-trip must carry the
   negotiated context (fine if the protocol provides it per request; a limitation if a
   client implementation caches capabilities server-side expectations).
7. **Logging correlation**: `sessionId` disappears from logs; request-level correlation
   relies on `request.id` (already on `ToolExecutionContext.request`) plus the
   `x-request-id` header forwarded through `request.headers` — operators lose a
   coarse-grained "everything from client X" filter unless client identity (Phase 3A)
   is logged instead.

## 7. What genuinely still needs state-of-a-sort

| State                                           | Where it must live                                           | Why it can't be pure per-request                                          |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Open MongoDB connections (`MCPConnectionStore`) | App-level, keyed by `connectionId` (+ client-identity scope) | TCP/auth handshakes are expensive; connect-once/query-many is the core UX |
| In-flight connection dials / OIDC device-flow   | Per `ConnectionEntry` (already is)                           | Multi-request polling (`connectCluster` polls `state`)                    |
| Keychain secrets                                | App-level singleton (already is)                             | Secret redaction across all logs; registered by connect tools for reuse   |
| Client identity & capabilities                  | **Request-carried** (from protocol envelope) — not stored    | Needed per request for `appName`, elicitation, scoping                    |
| Exports on disk                                 | App-level dir, client-keyed or TTL expiry                    | A download may span requests                                              |
| Atlas temp-user credentials pending revocation  | Tied to `ConnectionEntry.onRevoke` (already is)              | Cleanup must fire when the connection closes, regardless of which request |
| Metrics/registry/monitoring                     | App-level (already is)                                       | Process-wide aggregation                                                  |

The one thing we deliberately **eliminate** is server-side per-client objects with
lifecycle (create → idle → evict → close): no session store, no session timers, no
`mcp-session-id` routing, no per-session transports.

## 8. Open questions for implementation kickoff

1. Phase 3: client-identity scoping (A) vs global-only (B)? — A preserves current
   multi-tenant HTTP security semantics; B is simpler.
2. Do we drop the legacy HTTP sessionful protocol in the same release, or stage it
   behind a deprecation flag?
3. Should per-request HTTP config overrides remain fully general (requires
   request-aware tool config) or be restricted?
4. Exports: client-keyed directories vs TTL-based expiry sweep?
