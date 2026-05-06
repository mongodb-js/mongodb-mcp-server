# Design: `atlas-create-dedicated-cluster`

**Date:** 2026-05-06  
**Author:** Andrea Angiolillo  
**Hackathon:** APIx Offsite Barcelona

---

## Overview

A new MCP tool that creates a dedicated MongoDB Atlas cluster (M10+). Fills the most-requested gap in the current tooling — `atlas-create-free-cluster` only supports M0. Covers REPLICASET (single-region and multi-region) and SHARDED cluster types (!what about multi region for sharded cluster?). Follows existing tool conventions strictly: single responsibility, no access list or DB user setup, fire-and-forget creation.

---

## Architecture

**File:** `src/tools/atlas/create/createDedicatedCluster.ts`  
**Registration:** one export added to `src/tools/atlas/tools.ts`  
**Class:** `CreateDedicatedClusterTool extends AtlasToolBase`

| Property | Value |
|---|---|
| `toolName` | `atlas-create-dedicated-cluster` |
| `category` | `atlas` |
| `operationType` | `create` |

**Does NOT:**
- Call `ensureCurrentIpInAccessList` — avoids "leaked IP on failure" partial state; `atlas-connect-cluster` handles access list when connecting
- Create a DB user — separate concern, use `atlas-create-db-user`
- Poll/wait for cluster to become IDLE — fire and forget; `atlas-connect-cluster` waits internally

---

## Args Shape

All fields optional except `projectId`. Elicitation targets the four fields a user must consciously decide. Everything else has sensible defaults.

| Param | Type | Default | Elicited | Notes                                                                                                          |
|---|---|---|---|----------------------------------------------------------------------------------------------------------------|
| `projectId` | `string` | — | no | Required. `AtlasArgs.projectId()`                                                                              |
| `name` | `string` | — | **yes** | `AtlasArgs.clusterName()`                                                                                      |
| `provider` | `"AWS" \| "GCP" \| "AZURE"` | `"AWS"` | **yes** |                                                                                                                |
| `region` | `string` | `"US_EAST_1"` | **yes** | Provider-specific region name                                                                                  |
| `instanceSize` | `string` | `"M10"` | **yes** | M10–M80 dedicated tiers                                                                                        |
| `numShards` | `number` | `1` | no | ≥2 → SHARDED; enforces M30+                                                                                    |
| `additionalRegions` | `string[]` | `[]` | no | Secondary regions; priorities auto-assigned 6, 5, 4…; inherit same `instanceSize` and `autoScaling` as primary |
| `autoScaling` | `boolean` | `true` | no | Enables compute + disk autoscaling                                                                             |
| `autoScalingMaxInstanceSize` | `string` | `"M40"` | no | Required when `autoScaling: true`                                                                              |
| `mongoDBMajorVersion` | `string` | omitted | no | e.g. `"8.0"`. Atlas picks its default (latest stable) when absent                                              |
| `versionReleaseSystem` | `"LTS" \| "CONTINUOUS"` | omitted | no | Opt-in. Mutually exclusive with `mongoDBMajorVersion`                                                          |
| `backupEnabled` | `boolean` | `false` | no | Enables cloud backup (continuous snapshots). Requires M10+; strongly recommended for production |
| `pitEnabled` | `boolean` | `false` | no | Enables point-in-time recovery. Requires `backupEnabled: true` |
| `terminationProtectionEnabled` | `boolean` | `false` | no |                                                                                                                |

**`clusterType` is derived, not a parameter:** `numShards === 1` → `REPLICASET`, `numShards >= 2` → `SHARDED`. Claude decides when to pass `numShards >= 2` based on workload context, guided by the tool description.

---

## Tool Description (LLM-facing)

```
Creates a dedicated MongoDB Atlas cluster (M10 or larger). Supports replica sets 
and sharded clusters across single or multiple regions.

Use numShards: 2 or more for high-volume workloads requiring horizontal scaling 
(typically >10TB data or very high write throughput). For most production use cases, 
the default replica set (numShards: 1) provides high availability without the 
operational overhead of sharding. Sharded clusters require M30 or larger.

For multi-region deployments, pass at least 2 entries in additionalRegions (3 total 
regions) to meet the minimum ≥5 electable nodes across regions best practice.

Enable backupEnabled: true for any production cluster. Enable pitEnabled: true 
alongside backupEnabled for point-in-time recovery.

Does not set up network access or database users. After creation, use 
atlas-connect-cluster to connect (it handles access list and temporary credentials).
To pause a cluster after creation, use atlas-pause-cluster (it waits for IDLE then 
issues the pause).
```

---

## Elicitation Flow

Only `name`, `provider`, `region`, and `instanceSize` trigger elicitation when missing. The form shows only the fields that are actually absent.

```
execute() called
    │
    ├─ all 4 fields present? ──────────────────────────────► Phase 2: Validate
    │
    └─ any missing?
          │
          ├─ supportsElicitation() = true
          │       │
          │       └─ show form (missing fields only)
          │               │
          │               ├─ accepted ──► fill fields ──► Phase 2: Validate
          │               └─ cancelled ──► return "Operation cancelled."
          │
          └─ supportsElicitation() = false
                  │
                  └─ return structured missing-fields message:
                     "To create a dedicated cluster I need:
                      - name: cluster name
                      - provider: AWS, GCP, or AZURE
                      - region: e.g. US_EAST_1
                      - instanceSize: M10, M20, M30, ..."
                     (Claude reads this and asks the user conversationally)
```

---

## Execute Logic

### Phase 1 — Fill missing fields
Elicitation or structured fallback message (see above).

### Phase 2 — Validate
- `numShards > 1` and `instanceSize < M30` → error before any API call. Instance size comparison is numeric: parse the integer from the string (`"M30"` → `30`, `"M100"` → `100`).
- `autoScaling: true` and `autoScalingMaxInstanceSize < instanceSize` → error (same numeric comparison)
- `versionReleaseSystem: "CONTINUOUS"` and `mongoDBMajorVersion` both set → error
- `pitEnabled: true` and `backupEnabled: false` → error (`pitEnabled` requires `backupEnabled`)

### Phase 3 — Build body and call API

```
clusterType = numShards > 1 ? "SHARDED" : "REPLICASET"

primaryRegionConfig = {
    providerName: provider,
    regionName: region,
    priority: 7,
    electableSpecs: { instanceSize, nodeCount: 3 },
    ...(autoScaling && {
        autoScaling: {
            compute: { enabled: true, scaleDownEnabled: true,
                        minInstanceSize: instanceSize,
                        maxInstanceSize: autoScalingMaxInstanceSize },
            diskGB: { enabled: true }
        }
    })
}

regionConfigs = [
    primaryRegionConfig,
    ...additionalRegions.map((regionName, i) => ({
        ...primaryRegionConfig,
        regionName,
        priority: 6 - i,
    }))
]

replicationSpec = { zoneName: "Zone 1", regionConfigs }

body = {
    name,
    clusterType,
    terminationProtectionEnabled,
    backupEnabled,
    ...(pitEnabled && { pitEnabled }),   // pitEnabled requires backupEnabled: true
    replicationSpecs: Array(numShards).fill(replicationSpec),
    ...(mongoDBMajorVersion && { mongoDBMajorVersion }),
    ...(versionReleaseSystem && { versionReleaseSystem }),
}

await apiClient.createCluster({ params: { path: { groupId: projectId } }, body })
```

### Return value (fire and forget)
```
Cluster "{name}" creation initiated.
- Type: REPLICASET / SHARDED ({n} shards)
- Provider: {provider} | Region: {region}{additional regions}
- Instance size: {instanceSize} | Autoscaling: up to {max} / disabled

Status: CREATING — typically takes 7-10 minutes.
Use atlas-inspect-cluster to check status, or atlas-connect-cluster 
to connect (it will wait until the cluster is ready).
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| `numShards > 1` + `instanceSize < M30` | Validation error before API call |
| `autoScalingMaxInstanceSize < instanceSize` | Validation error before API call |
| `versionReleaseSystem: CONTINUOUS` + `mongoDBMajorVersion` set | Validation error before API call |
| `pitEnabled: true` + `backupEnabled: false` | Validation error before API call |
| Elicitation cancelled | `"Operation cancelled."` |
| Atlas 409 — cluster name already exists | `"A cluster named '{name}' already exists in this project."` |
| Atlas 402 — payment required | Handled automatically by `AtlasToolBase` |
| Atlas 401/403 | Handled automatically by `AtlasToolBase` |

All validation errors fire before any API call — no partial state from our tool.

---

## Testing

### Unit tests (`tests/unit/`)
No Atlas credentials needed. Fast, always run in CI.

- `argsShape` has correct fields and types (including `backupEnabled`, `pitEnabled`)
- Validation error: `numShards: 2` + `instanceSize: "M10"` → rejects before API call
- Validation error: `autoScalingMaxInstanceSize: "M10"` + `instanceSize: "M20"` → rejects
- Validation error: `versionReleaseSystem: "CONTINUOUS"` + `mongoDBMajorVersion: "8.0"` → rejects
- Validation error: `pitEnabled: true` + `backupEnabled: false` → rejects before API call
- Body builder: `backupEnabled: true` appears in request body
- Body builder: `pitEnabled: true` + `backupEnabled: true` → both appear in request body
- Body builder: REPLICASET produces 1 `replicationSpecs` entry
- Body builder: `numShards: 3` produces 3 identical `replicationSpecs` entries
- Body builder: `additionalRegions: ["EU_WEST_1", "EU_CENTRAL_1"]` produces `regionConfigs` with priorities 7, 6, 5

### Integration tests (`tests/integration/tools/atlas/clusters.test.ts`)
Runs against cloud-dev in CI. Added inside the existing `describeWithAtlas` + `withProject` block.

```ts
describe("atlas-create-dedicated-cluster", () => {
    it("should have correct metadata")
    // checks inputSchema has projectId, name, provider, region, instanceSize, numShards,
    // backupEnabled, pitEnabled

    it("should create a replica set cluster")
    // call with all required args, verify response contains name + "creation initiated"
    // verify cluster exists via apiClient.getCluster()

    it("should create a cluster with backup enabled")
    // backupEnabled: true, verify response mentions backup
    // verify apiClient.getCluster() returns backupEnabled: true

    it("should create a sharded cluster")
    // numShards: 2, instanceSize: "M30"
    // verify response mentions "SHARDED (2 shards)"

    it("should create a multi-region cluster")
    // additionalRegions: ["US_WEST_2", "EU_WEST_1"], instanceSize: "M30"
    // verify response mentions 3 regions, verify regionConfigs has 3 entries

    it("should reject sharded cluster with instanceSize below M30")
    // numShards: 2, instanceSize: "M10"
    // verify isError: true, message mentions M30 requirement

    it("should reject pitEnabled without backupEnabled")
    // pitEnabled: true, backupEnabled: false (default)
    // verify isError: true, message mentions backupEnabled requirement
})
```

Cleanup: `afterAll` uses the existing `deleteCluster` helper from `atlasHelpers.ts`.

### Accuracy tests (`tests/accuracy/createDedicatedCluster.test.ts`)
LLM-driven. Verifies Claude picks the right tool and params from natural language.

```ts
// Explicit production cluster on AWS (case_8 ex1 — dev M10, autoscaling, no backup)
{ prompt: "Create a production MongoDB cluster on AWS called my-app",
  expectedToolCalls: [{ toolName: "atlas-create-dedicated-cluster",
    parameters: { provider: "AWS", name: "my-app" } }] }

// Budget production M30+, backup enabled (case_8 ex3)
{ prompt: "Create a production M30 cluster in US_EAST_1 with backup enabled",
  expectedToolCalls: [{ toolName: "atlas-create-dedicated-cluster",
    parameters: {
        instanceSize: Matcher.value("M30"),
        region: Matcher.value("US_EAST_1"),
        backupEnabled: Matcher.value(true),
    } }] }

// Multi-region cluster, 3 regions, backup (case_8 ex4)
{ prompt: "Create a multi-region M30 cluster across US_EAST_1, US_WEST_2, and EU_WEST_1 with backup",
  expectedToolCalls: [{ toolName: "atlas-create-dedicated-cluster",
    parameters: {
        instanceSize: Matcher.value("M30"),
        additionalRegions: Matcher.arrayLength(2),   // ≥2 additional → 3 total
        backupEnabled: Matcher.value(true),
    } }] }

// Sharded cluster for high write throughput
{ prompt: "I need a sharded MongoDB cluster for high write throughput",
  expectedToolCalls: [{ toolName: "atlas-create-dedicated-cluster",
    parameters: { numShards: Matcher.value(2) } }] }

// Generic instance request — must default to replica set
{ prompt: "I need a MongoDB instance running",
  expectedToolCalls: [{ toolName: "atlas-create-dedicated-cluster",
    parameters: {
        numShards: Matcher.anyOf(Matcher.value(1), Matcher.undefined),
    } }] }
```

---

## Companion Tools Required

The hackathon eval cases ex3 and ex4 require **pausing a cluster after creation**. This tool is fire-and-forget and does not poll or pause. A separate `atlas-pause-cluster` tool must be built to fulfil that requirement:

- `atlas-pause-cluster` accepts `projectId` + `clusterName`, polls `getCluster` until `stateName === "IDLE"`, then calls `updateCluster({ paused: true })`.
- The LLM agent orchestrates: call `atlas-create-dedicated-cluster` → then call `atlas-pause-cluster`.

---

## Out of Scope

| Feature | Reason |
|---|---|
| GEOSHARDED (Global Clusters) | Fundamentally different body shape; deserves its own tool |
| `atlas-delete-cluster` | Separate tool; `deleteCluster` helper already exists for tests |
| `waitForReady` polling | Fire-and-forget is consistent with existing tools; `atlas-connect-cluster` and `atlas-pause-cluster` handle waiting |
| Access list setup | Separate concern; avoids partial state on failure |
| DB user creation | Separate concern; use `atlas-create-db-user` |
