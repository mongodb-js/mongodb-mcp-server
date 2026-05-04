# Hackathon Guide — Extending the MongoDB MCP Server

A focused guide for humans and coding agents participating in the hackathon. The goal of the hackathon is to **expand over the current cluster-creation tooling**. This document covers:

1. The anatomy of a tool in this repo
2. How to add a new tool (step-by-step)
3. How to consume the Atlas cluster-creation operation and its schema
4. How to run and test your changes locally against **cloud-dev** (not prod)

---

## 1. Project layout (cheat sheet)

```
src/
├── tools/
│   ├── tool.ts                     # Abstract ToolBase + ToolClass types (read this first)
│   ├── args.ts                     # Shared Zod validators (AtlasArgs, CommonArgs)
│   ├── index.ts                    # AllTools registry — every tool must be re-exported here
│   ├── atlas/
│   │   ├── atlasTool.ts            # AtlasToolBase — extend this for Atlas API tools
│   │   ├── tools.ts                # Re-exports every Atlas tool (add yours here)
│   │   ├── create/
│   │   │   ├── createFreeCluster.ts    # Reference implementation for the hackathon
│   │   │   └── ...
│   │   └── read/
│   └── mongodb/                    # Data-plane tools (non-relevant for cluster creation)
├── common/
│   └── atlas/
│       ├── apiClient.ts            # Typed wrapper around the Atlas REST API
│       ├── openapi.d.ts            # Generated Atlas OpenAPI types (source of truth for schemas)
│       └── accessListUtils.ts      # ensureCurrentIpInAccessList helper
└── common/config/userConfig.ts     # User-facing config schema (apiBaseUrl, credentials, etc.)
```

Key files to read before coding:

- [src/tools/tool.ts](src/tools/tool.ts) — `ToolBase`, `argsShape`, `execute`, `resolveTelemetryMetadata`
- [src/tools/atlas/atlasTool.ts](src/tools/atlas/atlasTool.ts) — `AtlasToolBase` adds `this.apiClient` and Atlas-specific error handling
- [src/tools/atlas/create/createFreeCluster.ts](src/tools/atlas/create/createFreeCluster.ts) — the canonical cluster-creation example
- [src/common/atlas/apiClient.ts](src/common/atlas/apiClient.ts) — typed Atlas API methods (`createCluster`, `getCluster`, ...)

---

## 2. Anatomy of a tool

Every tool extends `ToolBase` (or more specifically `AtlasToolBase` for Atlas API tools) and provides four things:

| Member | Purpose |
| --- | --- |
| `static toolName` | MCP tool ID (kebab-case, globally unique, e.g. `atlas-create-free-cluster`) |
| `static category` | `"atlas" \| "atlas-local" \| "mongodb" \| "assistant"` — used for bulk enable/disable |
| `static operationType` | `"metadata" \| "read" \| "create" \| "update" \| "delete" \| "connect"` — governs `readOnly` mode and destructive-hint annotations |
| `description` | Human text shown to the LLM; make it action-oriented |
| `argsShape` | `ZodRawShape` — the tool's input schema. Use `AtlasArgs` helpers for consistency |
| `execute(args)` | The actual implementation — returns a `CallToolResult` |
| `resolveTelemetryMetadata(args, { result })` | Return `{}` if you don't need custom telemetry (AtlasToolBase already extracts `projectId`/`orgId`) |

The server discovers tools by iterating `AllTools` in [src/tools/index.ts](src/tools/index.ts). A tool is registered only if:

- Atlas credentials are configured (for Atlas tools) — see `AtlasToolBase.verifyAllowed`
- The tool's category / name / operationType is not in `config.disabledTools`
- `config.readOnly` is false OR the `operationType` is `read`/`metadata`/`connect`

---

## 3. Adding a new tool — step by step

### 3.1 Pick a home and a name

For cluster-creation variants, put new tools under [src/tools/atlas/create/](src/tools/atlas/create/). Pick a `toolName` that reads like the others (`atlas-create-dedicated-cluster`, `atlas-create-sharded-cluster`, etc.).

### 3.2 Write the tool class

Use [createFreeCluster.ts](src/tools/atlas/create/createFreeCluster.ts) as the template, and mirror the `body` shape against the reference payloads in [hackathon-examples/](hackathon-examples/) (see §4.3). Minimal skeleton:

```ts
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { ensureCurrentIpInAccessList } from "../../../common/atlas/accessListUtils.js";
import { AtlasArgs } from "../../args.js";
import { z } from "zod";

export class CreateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-dedicated-cluster";
    public description = "Create a dedicated MongoDB Atlas cluster";
    static operationType: OperationType = "create";

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID"),
        name: AtlasArgs.clusterName().describe("Name of the cluster"),
        region: AtlasArgs.region().describe("Region").default("US_EAST_1"),
        instanceSize: z.enum(["M10", "M20", "M30"]).default("M10"),
        provider: z.enum(["AWS", "AZURE", "GCP"]).default("AWS"),
    };

    protected async execute({
        projectId, name, region, instanceSize, provider,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const body = {
            groupId: projectId,
            name,
            clusterType: "REPLICASET",
            replicationSpecs: [{
                zoneName: "Zone 1",
                regionConfigs: [{
                    providerName: provider,
                    regionName: region,
                    electableSpecs: { instanceSize, nodeCount: 3 },
                    priority: 7,
                }],
            }],
            terminationProtectionEnabled: false,
        } as unknown as ClusterDescription20240805;

        await ensureCurrentIpInAccessList(this.apiClient, projectId);
        await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body,
        });

        return {
            content: [{ type: "text", text: `Cluster "${name}" (${instanceSize}) requested in ${region}.` }],
        };
    }
}
```

Notes:

- `AtlasToolBase` exposes `this.apiClient` (an authenticated Atlas API client) and `this.config`, `this.session`, `this.telemetry`, `this.elicitation`.
- `AtlasToolBase` provides a `resolveTelemetryMetadata` that already pulls `projectId`/`orgId` off the args — you only need to override it if you have extra fields to track.
- For destructive/sensitive tools, add the `toolName` to `confirmationRequiredTools` in [userConfig.ts](src/common/config/userConfig.ts) so the server requests elicitation before running.
- Errors thrown as `ApiClientError` are formatted nicely by `AtlasToolBase.handleError` (401/402/403 messages are pre-baked).

### 3.3 Register the tool

Add one line to [src/tools/atlas/tools.ts](src/tools/atlas/tools.ts):

```ts
export { CreateDedicatedClusterTool } from "./create/createDedicatedCluster.js";
```

That is the only registration step — [src/tools/index.ts](src/tools/index.ts) aggregates `AllTools` from the re-exports.

### 3.4 Add a test

Mirror the existing pattern in [tests/integration/tools/atlas/clusters.test.ts](tests/integration/tools/atlas/clusters.test.ts). Use `describeWithAtlas` + `withProject` — they pre-wire cloud-dev, create a scratch project, and clean up afterwards. See §5 below.

### 3.5 Public-API check

Adding a new tool class usually triggers an api-extractor diff because tools are re-exported through the package surface. If `pnpm run check:api` complains (it runs as part of `pnpm run check` and in CI), run:

```bash
pnpm run update:api
```

Commit the refreshed reports under `api-extractor/reports/`.

---

## 4. Consuming cluster creation — API & schema

### 4.1 The API method

`this.apiClient.createCluster(options)` in [src/common/atlas/apiClient.ts:313](src/common/atlas/apiClient.ts:313) wraps `POST /api/atlas/v2/groups/{groupId}/clusters`.

```ts
async createCluster(
    options: FetchOptions<operations["createGroupCluster"]>
): Promise<components["schemas"]["ClusterDescription20240805"]>
```

Call shape:

```ts
await this.apiClient.createCluster({
    params: { path: { groupId: projectId } },
    body: clusterDescription, // ClusterDescription20240805
});
```

The client handles auth, user-agent, API version (`Accept: application/vnd.atlas.2025-03-12+json` — pinned in [apiClient.ts:13](src/common/atlas/apiClient.ts:13) as `ATLAS_API_VERSION`), and raises `ApiClientError` on non-2xx.

**Version bucketing — why bodies must match `2024-10-23` even though the header says `2025-03-12`:** the Atlas Admin API resolves an `Accept` version as "use the latest handler at or before this date." `createGroupCluster`'s latest concrete version is `2024-10-23` (see [openapi.d.ts:8892](src/common/atlas/openapi.d.ts:8892)), so the pinned `2025-03-12` header routes to the `2024-10-23` handler and the request body must match that schema — i.e. the Independent Shard Scaling shape used in [hackathon-examples/](hackathon-examples/) (one `replicationSpecs[]` entry per shard, no `numShards`). `ClusterDescription20240805` is already that schema, so `apiClient.createCluster({ body })` accepts the example payloads directly with no shape translation.

Two caveats this raises:

- If you add an `apiClient` method for an endpoint whose *latest* version is newer than `2025-03-12`, the global pin will silently fall back to an older handler. Either bump `ATLAS_API_VERSION` (and regenerate `openapi.d.ts`) or override `Accept` on that specific call — the pattern for per-call overrides is in [apiClient.ts:640](src/common/atlas/apiClient.ts:640) and [apiClient.ts:811](src/common/atlas/apiClient.ts:811).
- Old API-version shapes (anything with `numShards`, or response-only fields like `effectiveReplicationSpecs`) will not pass validation — always shape requests against the live examples in `hackathon-examples/`.

Related methods you will likely also need:

| Method | Purpose |
| --- | --- |
| `apiClient.getCluster({ params: { path: { groupId, clusterName } } })` | Poll state |
| `apiClient.listClusters({ params: { path: { groupId } } })` | Enumerate clusters |
| `apiClient.deleteCluster({ params: { path: { groupId, clusterName } } })` | Tear down |
| `ensureCurrentIpInAccessList(apiClient, projectId)` | Add caller IP to the project's access list (needed before connecting) |

### 4.2 The schema — `ClusterDescription20240805`

The full TypeScript type lives in [src/common/atlas/openapi.d.ts](src/common/atlas/openapi.d.ts) at line 2511 (and is re-exported as `ClusterDescription20240805`). Key fields for creation:

| Field | Notes |
| --- | --- |
| `name` | Cluster name (see `AtlasArgs.clusterName()` for validation) |
| `clusterType` | `"REPLICASET" \| "SHARDED" \| "GEOSHARDED"` |
| `replicationSpecs[]` | One entry for replica sets; one per shard for sharded clusters |
| `replicationSpecs[].regionConfigs[]` | Per-region node config |
| `...regionConfigs[].providerName` | `"AWS" \| "AZURE" \| "GCP" \| "TENANT"` (TENANT ⇒ free/shared M0/M2/M5) |
| `...regionConfigs[].backingProviderName` | Required when `providerName = "TENANT"` |
| `...regionConfigs[].regionName` | Cloud region (e.g. `"US_EAST_1"`) |
| `...regionConfigs[].electableSpecs.instanceSize` | `"M0"` free; `"M10"`+ dedicated; see file for full enum |
| `...regionConfigs[].electableSpecs.nodeCount` | Required for M10+ (typically 3) |
| `...regionConfigs[].priority` | Required for dedicated; `7` for primary region |
| `backupEnabled`, `pitEnabled`, `terminationProtectionEnabled`, `tags`, `mongoDBMajorVersion`, `replicaSetScalingStrategy`, `encryptionAtRestProvider` | Optional tuning knobs — all documented inline in `openapi.d.ts` |

The repo uses `as unknown as ClusterDescription20240805` casts in several places because the generated type has many `readonly` fields and union variants. That pattern is fine — keep input shaping in your tool, and let the API layer return the real description.

### 4.3 Reference request/response payloads

The [hackathon-examples/](hackathon-examples/) directory contains **real request bodies and the exact API responses** captured from cloud-dev. Use these as the source of truth when shaping the `body` you pass to `this.apiClient.createCluster(...)` — if your tool's payload doesn't match the shape of these requests, it will not create a cluster.

| File | What it demonstrates |
| --- | --- |
| [hackathon-examples/replica-set-request.json](hackathon-examples/replica-set-request.json) | Minimal `REPLICASET` body with compute + disk autoscaling on a single region config |
| [hackathon-examples/replica-set-response.json](hackathon-examples/replica-set-response.json) | Full response returned by the API (fields you can read after creation) |
| [hackathon-examples/sharded-request.json](hackathon-examples/sharded-request.json) | `SHARDED` body — **one `replicationSpecs[]` entry per shard** (Independent Shard Scaling format) |
| [hackathon-examples/sharded-response.json](hackathon-examples/sharded-response.json) | Full response for the two-shard cluster |

Key rules these examples encode:

- **Sharded clusters use one `replicationSpecs[]` entry per shard** — there is no `numShards` field in this API version. A two-shard symmetric cluster has two identical entries; asymmetric shards just differ in their `regionConfigs[].electableSpecs.instanceSize`.
- **`autoScaling` belongs on each `regionConfigs[]` entry**, not on the top-level cluster. When `compute.enabled` is `true`, `maxInstanceSize` is required; when `scaleDownEnabled` is `true`, `minInstanceSize` is also required.
- **`priority: 7`** marks the primary region and is required for any dedicated tier (M10+).
- **Dedicated tiers require `electableSpecs.nodeCount`** (typically `3`); omit it only for `TENANT` free/flex configs.

To re-verify a payload end-to-end against cloud-dev before wiring it into a tool:

```bash
atlas api clusters createCluster \
  --profile <your-cloud-dev-profile> \
  --version 2024-10-23 \
  --groupId <projectId> \
  --file hackathon-examples/replica-set-request.json \
  --pretty
```

The `atlas api` command group is autogenerated 1:1 from the Atlas OpenAPI spec, so a body that succeeds there will succeed from `this.apiClient.createCluster(...)` with the same `2024-10-23`-compatible shape.

### 4.4 Finding other operations

`openapi.d.ts` is the canonical source. Search for an operation ID (e.g. `createGroupCluster`) or a schema name (e.g. `FlexClusterDescriptionCreate20241113`) to find request/response shapes. When you need an API method that does not yet exist on `ApiClient`, add a thin wrapper in [apiClient.ts](src/common/atlas/apiClient.ts) following the same `openapi-fetch` pattern used by `createCluster`.

---

## 5. Running and testing locally against cloud-dev

### 5.1 One-time setup

The repo requires Node **`^20.19 || ^22.12 || >=24`** (see `engines` in `package.json`). Pick one via your manager of choice. Common invocations:

```bash
# nvm
nvm install 22.12 && nvm use 22.12

# asdf
asdf plugin add nodejs && asdf install nodejs 22.12.0 && asdf local nodejs 22.12.0

# fnm
fnm install 22.12 && fnm use 22.12

# Homebrew (no version manager)
brew install node@22 && brew link --overwrite node@22
```

Then:

```bash
node --version     # confirm the active Node satisfies the range above
pnpm install
pnpm run build     # required before `inspect` or tests
```

Get an Atlas **cloud-dev** service-account client ID/secret from the MongoDB internal tooling (ask your hackathon host if unsure). Export them:

```bash
export MDB_MCP_API_CLIENT_ID="...dev service-account client id..."
export MDB_MCP_API_CLIENT_SECRET="...dev service-account secret..."
export MDB_MCP_API_BASE_URL="https://cloud-dev.mongodb.com"
```

The env-var convention is `MDB_MCP_<CAMELCASE_CONFIG_KEY_UPPERCASED>`, so `apiBaseUrl` becomes `MDB_MCP_API_BASE_URL`. All config keys live in [src/common/config/userConfig.ts](src/common/config/userConfig.ts) — the default `apiBaseUrl` is `https://cloud.mongodb.com/` (prod), so you **must** override it to hit cloud-dev.

### 5.2 Interactive testing with the MCP Inspector (recommended)

```bash
pnpm run inspect
```

This runs `pnpm run build` and launches the MCP Inspector against `dist/esm/index.js`. Because the Inspector inherits your shell env, your cloud-dev credentials + `MDB_MCP_API_BASE_URL` flow through automatically. You can then:

1. Open the Inspector URL printed in the terminal
2. Call `atlas-list-projects` to confirm auth works
3. Call your new tool with hand-crafted args and inspect the response + server logs

Alternatively you can pass config via CLI flags instead of env vars:

```bash
node dist/esm/index.js \
  --apiBaseUrl https://cloud-dev.mongodb.com \
  --apiClientId "$MDB_MCP_API_CLIENT_ID" \
  --apiClientSecret "$MDB_MCP_API_CLIENT_SECRET"
```

**If the Inspector can't Connect:** the UI shows a generic connection error, but the real signal is the terminal tab running `pnpm run inspect` — crashes in the spawned server process surface there. Running the server directly with the command above reproduces the same failure without the Inspector wrapper and usually points straight at the cause (wrong Node version, missing env var, `dist/esm/index.js` not built, etc.).

### 5.3 Wiring your MCP client (VS Code / Cursor / Claude Desktop)

Point the client at the built entry and pass the same env vars. Example config:

```json
{
  "mcpServers": {
    "MongoDB": {
      "command": "node",
      "args": ["/absolute/path/to/mongodb-mcp-server/dist/esm/index.js"],
      "env": {
        "MDB_MCP_API_CLIENT_ID": "...",
        "MDB_MCP_API_CLIENT_SECRET": "...",
        "MDB_MCP_API_BASE_URL": "https://cloud-dev.mongodb.com"
      }
    }
  }
}
```

Rebuild (`pnpm run build`) and restart the MCP server inside the client after each code change.

### 5.4 Automated integration tests

The Atlas integration harness in [tests/integration/tools/atlas/atlasHelpers.ts](tests/integration/tools/atlas/atlasHelpers.ts) defaults `apiBaseUrl` to `https://cloud-dev.mongodb.com` when no override is set. To run them:

```bash
export MDB_MCP_API_CLIENT_ID="..."
export MDB_MCP_API_CLIENT_SECRET="..."
# MDB_MCP_API_BASE_URL is optional — defaults to cloud-dev

pnpm test tests/integration/tools/atlas/clusters.test.ts
```

Without the two `MDB_MCP_API_CLIENT_*` env vars, `describeWithAtlas` switches to `describe.skip`, so tests pass trivially in CI but don't exercise the API. Use `withProject` / `withCluster` helpers — they create and tear down a scratch project (and cluster) in cloud-dev on each run.

To skip Atlas-touching tests entirely:

```bash
pnpm run test:local   # SKIP_ATLAS_INTEGRATION_TESTS=true SKIP_ATLAS_LOCAL_TESTS=true
```

### 5.5 Cleanup

Integration tests clean up after themselves, but if something crashes mid-run you may leave stray projects/clusters in cloud-dev. The script [scripts/cleanupAtlasTestLeftovers.test.ts](scripts/cleanupAtlasTestLeftovers.test.ts) knows how to reap them:

```bash
pnpm run atlas:cleanup
```

---

## 6. Quick checklist for your hackathon tool

- [ ] New file in `src/tools/atlas/create/` (or appropriate folder)
- [ ] Class extends `AtlasToolBase`, has `static toolName / category / operationType`
- [ ] `argsShape` uses `AtlasArgs` helpers and `.describe()` on every field
- [ ] `execute` calls `ensureCurrentIpInAccessList` if users will connect to the cluster
- [ ] Re-exported from [src/tools/atlas/tools.ts](src/tools/atlas/tools.ts)
- [ ] Build the server locally: `pnpm run build`
- [ ] Smoke test against cloud-dev via `pnpm run inspect` (MCP Inspector UI): confirm the tool appears, accepts args, and creates a cluster visible in the cloud-dev Atlas UI.
- [ ] End-to-end test through an MCP client (Claude Desktop, Cursor, VS Code, etc.) pointed at `dist/esm/index.js` — see §5.3. Drive the tool with a natural-language prompt and confirm the resulting cluster in the cloud-dev Atlas UI.
- [ ] `pnpm run check` passes locally (lint, types, format, API extractor)
- [ ] _(Optional)_ Integration test under `tests/integration/tools/atlas/` using `describeWithAtlas` + `withProject`

---

## 7. Useful references

- [CONTRIBUTING.md](CONTRIBUTING.md) — general contribution rules, release process, API-extractor workflow
- [MCP_SERVER_LIBRARY.md](MCP_SERVER_LIBRARY.md) — using this package as a library / custom tools from outside the repo
- [Atlas Admin API docs](https://www.mongodb.com/docs/atlas/reference/api-resources-spec/v2/) — authoritative spec; match the `2025-03-12` version served by `ApiClient`
