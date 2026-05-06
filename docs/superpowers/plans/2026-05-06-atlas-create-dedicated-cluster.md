# atlas-create-dedicated-cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `atlas-create-dedicated-cluster` MCP tool that creates M10+ Atlas clusters (replica sets and sharded, single- and multi-region) with backup support.

**Architecture:** Single new file extending `AtlasToolBase`, registered in `tools.ts`. `name` is the only arg without a Zod default — elicitation fires only when `name` is missing. All validation happens before any API call (fail-fast, no partial state). Fire-and-forget: returns immediately after `createCluster()`, does not poll.

**Tech Stack:** TypeScript, Zod, `@modelcontextprotocol/sdk`, Vitest

---

## File Map

| Action | Path |
|---|---|
| **Create** | `src/tools/atlas/create/createDedicatedCluster.ts` |
| **Modify** | `src/tools/atlas/tools.ts` (add one export line) |
| **Create** | `tests/unit/tools/atlas/create/createDedicatedCluster.test.ts` |
| **Modify** | `tests/integration/tools/atlas/clusters.test.ts` (add new `describe` block) |
| **Modify** | `docs/specs/2026-05-06-atlas-create-dedicated-cluster-design.md` (sync elicitation section) |

---

## Task 1: Unit tests (write first — TDD)

**Files:**
- Create: `tests/unit/tools/atlas/create/createDedicatedCluster.test.ts`

The unit test directory does not exist yet — it will be created when the file is written.

- [ ] **Step 1.1 — Write the full unit test file**

```typescript
// tests/unit/tools/atlas/create/createDedicatedCluster.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateDedicatedClusterTool } from "../../../../../src/tools/atlas/create/createDedicatedCluster.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("CreateDedicatedClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockElicitation: Record<string, ReturnType<typeof vi.fn>>;
    let tool: CreateDedicatedClusterTool;

    beforeEach(() => {
        mockApiClient = {
            createCluster: vi.fn().mockResolvedValue({}),
        };

        mockElicitation = {
            supportsElicitation: vi.fn().mockReturnValue(false),
            requestInput: vi.fn(),
            requestConfirmation: vi.fn(),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
        } as unknown as Session;

        const mockConfig = {
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
            apiClientId: "test-id",
            apiClientSecret: "test-secret",
        } as unknown as UserConfig;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as Telemetry;

        const params: ToolConstructorParams = {
            name: CreateDedicatedClusterTool.toolName,
            category: "atlas",
            operationType: CreateDedicatedClusterTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateDedicatedClusterTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    const baseArgs = {
        projectId: "aaaaaaaaaaaaaaaaaaaaaaaa",
        name: "my-cluster",
        provider: "AWS" as const,
        region: "US_EAST_1",
        instanceSize: "M10",
        numShards: 1,
        additionalRegions: [],
        autoScaling: true,
        autoScalingMaxInstanceSize: "M40",
        backupEnabled: true,
        pitEnabled: false,
        terminationProtectionEnabled: false,
    };

    describe("argsShape", () => {
        it("has required and optional fields with correct types", () => {
            const shape = tool.argsShape;
            expect(shape).toHaveProperty("projectId");
            expect(shape).toHaveProperty("name");
            expect(shape).toHaveProperty("provider");
            expect(shape).toHaveProperty("region");
            expect(shape).toHaveProperty("instanceSize");
            expect(shape).toHaveProperty("numShards");
            expect(shape).toHaveProperty("additionalRegions");
            expect(shape).toHaveProperty("autoScaling");
            expect(shape).toHaveProperty("autoScalingMaxInstanceSize");
            expect(shape).toHaveProperty("mongoDBMajorVersion");
            expect(shape).toHaveProperty("versionReleaseSystem");
            expect(shape).toHaveProperty("backupEnabled");
            expect(shape).toHaveProperty("pitEnabled");
            expect(shape).toHaveProperty("terminationProtectionEnabled");
        });
    });

    describe("validation", () => {
        it("rejects sharded cluster with instanceSize below M30", async () => {
            const result = await exec({ ...baseArgs, numShards: 2, instanceSize: "M10" });
            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("M30");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("rejects sharded cluster with M20", async () => {
            const result = await exec({ ...baseArgs, numShards: 2, instanceSize: "M20" });
            expect(result.isError).toBe(true);
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("allows sharded cluster with M30", async () => {
            await exec({ ...baseArgs, numShards: 2, instanceSize: "M30", autoScalingMaxInstanceSize: "M40" });
            expect(mockApiClient.createCluster).toHaveBeenCalled();
        });

        it("rejects autoScalingMaxInstanceSize smaller than instanceSize", async () => {
            const result = await exec({
                ...baseArgs,
                instanceSize: "M30",
                autoScaling: true,
                autoScalingMaxInstanceSize: "M10",
            });
            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("autoScalingMaxInstanceSize");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("allows autoScalingMaxInstanceSize equal to instanceSize", async () => {
            await exec({ ...baseArgs, instanceSize: "M20", autoScaling: true, autoScalingMaxInstanceSize: "M20" });
            expect(mockApiClient.createCluster).toHaveBeenCalled();
        });

        it("rejects versionReleaseSystem and mongoDBMajorVersion together", async () => {
            const result = await exec({
                ...baseArgs,
                versionReleaseSystem: "CONTINUOUS",
                mongoDBMajorVersion: "8.0",
            });
            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("mutually exclusive");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("rejects pitEnabled without backupEnabled", async () => {
            const result = await exec({ ...baseArgs, pitEnabled: true, backupEnabled: false });
            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("backupEnabled");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });
    });

    describe("body builder", () => {
        it("passes backupEnabled: true in request body by default", async () => {
            await exec({ ...baseArgs });
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ backupEnabled: true }),
                })
            );
        });

        it("passes backupEnabled: false when explicitly set", async () => {
            await exec({ ...baseArgs, backupEnabled: false });
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ backupEnabled: false }),
                })
            );
        });

        it("passes pitEnabled when backupEnabled is also true", async () => {
            await exec({ ...baseArgs, backupEnabled: true, pitEnabled: true });
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ backupEnabled: true, pitEnabled: true }),
                })
            );
        });

        it("produces 1 replicationSpecs entry for REPLICASET (numShards: 1)", async () => {
            await exec({ ...baseArgs, numShards: 1 });
            const body = mockApiClient.createCluster.mock.calls[0][0].body;
            expect(body.clusterType).toBe("REPLICASET");
            expect(body.replicationSpecs).toHaveLength(1);
        });

        it("produces 3 identical replicationSpecs entries for numShards: 3", async () => {
            await exec({ ...baseArgs, numShards: 3, instanceSize: "M30", autoScalingMaxInstanceSize: "M40" });
            const body = mockApiClient.createCluster.mock.calls[0][0].body;
            expect(body.clusterType).toBe("SHARDED");
            expect(body.replicationSpecs).toHaveLength(3);
        });

        it("produces regionConfigs with priorities 7, 6, 5 for 2 additionalRegions", async () => {
            await exec({
                ...baseArgs,
                additionalRegions: ["EU_WEST_1", "EU_CENTRAL_1"],
            });
            const regionConfigs = mockApiClient.createCluster.mock.calls[0][0].body.replicationSpecs[0].regionConfigs;
            expect(regionConfigs).toHaveLength(3);
            expect(regionConfigs[0].priority).toBe(7);
            expect(regionConfigs[0].regionName).toBe("US_EAST_1");
            expect(regionConfigs[1].priority).toBe(6);
            expect(regionConfigs[1].regionName).toBe("EU_WEST_1");
            expect(regionConfigs[2].priority).toBe(5);
            expect(regionConfigs[2].regionName).toBe("EU_CENTRAL_1");
        });

        it("includes autoScaling config when autoScaling is true", async () => {
            await exec({ ...baseArgs, autoScaling: true, instanceSize: "M20", autoScalingMaxInstanceSize: "M40" });
            const regionConfig = mockApiClient.createCluster.mock.calls[0][0].body.replicationSpecs[0].regionConfigs[0];
            expect(regionConfig.autoScaling).toBeDefined();
            expect(regionConfig.autoScaling.compute.enabled).toBe(true);
            expect(regionConfig.autoScaling.compute.minInstanceSize).toBe("M20");
            expect(regionConfig.autoScaling.compute.maxInstanceSize).toBe("M40");
            expect(regionConfig.autoScaling.diskGB.enabled).toBe(true);
        });

        it("omits autoScaling config when autoScaling is false", async () => {
            await exec({ ...baseArgs, autoScaling: false });
            const regionConfig = mockApiClient.createCluster.mock.calls[0][0].body.replicationSpecs[0].regionConfigs[0];
            expect(regionConfig.autoScaling).toBeUndefined();
        });

        it("passes projectId as groupId in path params", async () => {
            await exec({ ...baseArgs, projectId: "aaaaaaaaaaaaaaaaaaaaaaaa" });
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                expect.objectContaining({
                    params: { path: { groupId: "aaaaaaaaaaaaaaaaaaaaaaaa" } },
                })
            );
        });
    });

    describe("return message", () => {
        it("contains cluster name, type, provider, region, and status", async () => {
            const result = await exec({ ...baseArgs, name: "prod-cluster", provider: "AWS", region: "US_EAST_1" });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("prod-cluster");
            expect(text).toContain("REPLICASET");
            expect(text).toContain("AWS");
            expect(text).toContain("US_EAST_1");
            expect(text).toContain("CREATING");
        });

        it("mentions SHARDED and shard count for numShards > 1", async () => {
            const result = await exec({ ...baseArgs, numShards: 2, instanceSize: "M30", autoScalingMaxInstanceSize: "M40" });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("SHARDED");
            expect(text).toContain("2 shards");
        });
    });

    describe("elicitation", () => {
        it("returns structured message when name is missing and elicitation not supported", async () => {
            mockElicitation.supportsElicitation.mockReturnValue(false);
            const result = await exec({ ...baseArgs, name: undefined });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("name");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("returns 'Operation cancelled.' when user declines elicitation", async () => {
            mockElicitation.supportsElicitation.mockReturnValue(true);
            mockElicitation.requestInput.mockResolvedValue({ accepted: false });
            const result = await exec({ ...baseArgs, name: undefined });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toBe("Operation cancelled.");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });

        it("proceeds with creation when user provides name via elicitation", async () => {
            mockElicitation.supportsElicitation.mockReturnValue(true);
            mockElicitation.requestInput.mockResolvedValue({
                accepted: true,
                fields: { name: "elicited-cluster" },
            });
            const result = await exec({ ...baseArgs, name: undefined });
            expect(mockApiClient.createCluster).toHaveBeenCalled();
            const body = mockApiClient.createCluster.mock.calls[0][0].body;
            expect(body.name).toBe("elicited-cluster");
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("elicited-cluster");
        });
    });
});
```

- [ ] **Step 1.2 — Run tests to confirm they all fail (module not found)**

```bash
cd /Users/andrea.angiolillo/workspace/offsite/devTools-hackatone/fork/mongodb-mcp-server
pnpm vitest run --project unit-and-integration tests/unit/tools/atlas/create/createDedicatedCluster.test.ts
```

Expected: all tests fail with `Cannot find module '...createDedicatedCluster.js'`

---

## Task 2: Implement the tool

**Files:**
- Create: `src/tools/atlas/create/createDedicatedCluster.ts`

- [ ] **Step 2.1 — Write the implementation**

```typescript
// src/tools/atlas/create/createDedicatedCluster.ts
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type ToolArgs, type OperationType } from "../../tool.js";
import { AtlasToolBase } from "../atlasTool.js";
import type { ClusterDescription20240805 } from "../../../common/atlas/openapi.js";
import { AtlasArgs } from "../../args.js";

function parseInstanceSizeNum(size: string): number {
    const match = size.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
}

export class CreateDedicatedClusterTool extends AtlasToolBase {
    static toolName = "atlas-create-dedicated-cluster";
    static operationType: OperationType = "create";

    public description = `Creates a dedicated MongoDB Atlas cluster (M10 or larger). Supports replica sets and sharded clusters across single or multiple regions.

Use numShards: 2 or more for high-volume workloads requiring horizontal scaling (typically >10TB data or very high write throughput). For most production use cases, the default replica set (numShards: 1) provides high availability without the operational overhead of sharding. Sharded clusters require M30 or larger.

For multi-region deployments, pass at least 2 entries in additionalRegions (3 total regions) to meet the minimum ≥5 electable nodes across regions best practice.

Enable backupEnabled: true for any production cluster. Enable pitEnabled: true alongside backupEnabled for point-in-time recovery.

Does not set up network access or database users. After creation, use atlas-connect-cluster to connect (it handles access list and temporary credentials). To pause a cluster after creation, use atlas-pause-cluster (it waits for IDLE then issues the pause).`;

    public argsShape = {
        projectId: AtlasArgs.projectId().describe("Atlas project ID to create the cluster in"),
        name: AtlasArgs.clusterName().optional().describe("Name of the cluster"),
        provider: z
            .enum(["AWS", "GCP", "AZURE"])
            .default("AWS")
            .describe("Cloud provider: AWS, GCP, or AZURE"),
        region: AtlasArgs.region()
            .default("US_EAST_1")
            .describe("Cloud provider region name (e.g. US_EAST_1, EU_WEST_1)"),
        instanceSize: z
            .string()
            .default("M10")
            .describe("Instance size (M10–M80). Sharded clusters require M30 or larger"),
        numShards: z
            .number()
            .int()
            .min(1)
            .default(1)
            .describe("Number of shards. Use ≥2 for SHARDED clusters (requires M30+). Default: 1 (REPLICASET)"),
        additionalRegions: z
            .array(z.string())
            .default([])
            .describe(
                "Additional regions for multi-region deployment. Pass at least 2 for ≥5 total electable nodes best practice"
            ),
        autoScaling: z.boolean().default(true).describe("Enable compute and disk autoscaling"),
        autoScalingMaxInstanceSize: z
            .string()
            .default("M40")
            .describe("Maximum instance size when autoscaling is enabled"),
        mongoDBMajorVersion: z
            .string()
            .optional()
            .describe("MongoDB major version (e.g. '8.0'). Mutually exclusive with versionReleaseSystem"),
        versionReleaseSystem: z
            .enum(["LTS", "CONTINUOUS"])
            .optional()
            .describe("Version release system. Mutually exclusive with mongoDBMajorVersion"),
        backupEnabled: z
            .boolean()
            .default(true)
            .describe("Enable cloud backup (continuous snapshots). Defaults to true — set to false only for dev/test clusters where cost matters more than durability"),
        pitEnabled: z
            .boolean()
            .default(false)
            .describe("Enable point-in-time recovery. Requires backupEnabled: true"),
        terminationProtectionEnabled: z
            .boolean()
            .default(false)
            .describe("Prevent accidental cluster deletion"),
    };

    protected async execute(args: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        let {
            projectId,
            name,
            provider,
            region,
            instanceSize,
            numShards,
            additionalRegions,
            autoScaling,
            autoScalingMaxInstanceSize,
            mongoDBMajorVersion,
            versionReleaseSystem,
            backupEnabled,
            pitEnabled,
            terminationProtectionEnabled,
        } = args;

        // Phase 1: elicit name when missing
        if (!name) {
            if (this.elicitation.supportsElicitation()) {
                const result = await this.elicitation.requestInput(
                    "To create a dedicated cluster I need the cluster name.",
                    {
                        type: "object",
                        properties: {
                            name: {
                                type: "string",
                                title: "Cluster Name",
                                description: "Name for the cluster (letters, numbers, hyphens, 1–64 chars)",
                            },
                        },
                        required: ["name"],
                    }
                );
                if (!result.accepted) {
                    return { content: [{ type: "text", text: "Operation cancelled." }] };
                }
                name = result.fields.name;
            } else {
                return {
                    content: [
                        {
                            type: "text",
                            text: "To create a dedicated cluster I need:\n- name: cluster name (letters, numbers, hyphens)",
                        },
                    ],
                };
            }
        }

        // Phase 2: validate before any API call
        const instanceSizeNum = parseInstanceSizeNum(instanceSize);
        const maxInstanceSizeNum = parseInstanceSizeNum(autoScalingMaxInstanceSize);

        if (numShards > 1 && instanceSizeNum < 30) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Sharded clusters (numShards ≥ 2) require M30 or larger instance size. Got: ${instanceSize}.`,
                    },
                ],
                isError: true,
            };
        }
        if (autoScaling && maxInstanceSizeNum < instanceSizeNum) {
            return {
                content: [
                    {
                        type: "text",
                        text: `autoScalingMaxInstanceSize (${autoScalingMaxInstanceSize}) must be greater than or equal to instanceSize (${instanceSize}).`,
                    },
                ],
                isError: true,
            };
        }
        if (versionReleaseSystem && mongoDBMajorVersion) {
            return {
                content: [
                    {
                        type: "text",
                        text: "versionReleaseSystem and mongoDBMajorVersion are mutually exclusive. Provide only one.",
                    },
                ],
                isError: true,
            };
        }
        if (pitEnabled && !backupEnabled) {
            return {
                content: [
                    {
                        type: "text",
                        text: "pitEnabled requires backupEnabled: true.",
                    },
                ],
                isError: true,
            };
        }

        // Phase 3: build body and call API
        const clusterType = numShards > 1 ? "SHARDED" : "REPLICASET";

        const primaryRegionConfig = {
            providerName: provider,
            regionName: region,
            priority: 7,
            electableSpecs: { instanceSize, nodeCount: 3 },
            ...(autoScaling && {
                autoScaling: {
                    compute: {
                        enabled: true,
                        scaleDownEnabled: true,
                        minInstanceSize: instanceSize,
                        maxInstanceSize: autoScalingMaxInstanceSize,
                    },
                    diskGB: { enabled: true },
                },
            }),
        };

        const regionConfigs = [
            primaryRegionConfig,
            ...additionalRegions.map((regionName, i) => ({
                ...primaryRegionConfig,
                regionName,
                priority: 6 - i,
            })),
        ];

        const replicationSpec = { zoneName: "Zone 1", regionConfigs };

        const body = {
            name,
            clusterType,
            terminationProtectionEnabled,
            backupEnabled,
            ...(pitEnabled && { pitEnabled }),
            replicationSpecs: Array(numShards).fill(replicationSpec),
            ...(mongoDBMajorVersion && { mongoDBMajorVersion }),
            ...(versionReleaseSystem && { versionReleaseSystem }),
        } as unknown as ClusterDescription20240805;

        await this.apiClient.createCluster({
            params: { path: { groupId: projectId } },
            body,
        });

        const additionalRegionsText =
            additionalRegions.length > 0 ? ` + ${additionalRegions.join(", ")}` : "";
        const autoScalingText = autoScaling ? `up to ${autoScalingMaxInstanceSize}` : "disabled";
        const clusterTypeText = numShards > 1 ? `SHARDED (${numShards} shards)` : "REPLICASET";

        return {
            content: [
                {
                    type: "text",
                    text: [
                        `Cluster "${name}" creation initiated.`,
                        `- Type: ${clusterTypeText}`,
                        `- Provider: ${provider} | Region: ${region}${additionalRegionsText}`,
                        `- Instance size: ${instanceSize} | Autoscaling: ${autoScalingText}`,
                        `- Backup: ${backupEnabled ? "enabled" : "disabled"}`,
                        ``,
                        `Status: CREATING — typically takes 7-10 minutes.`,
                        `Use atlas-inspect-cluster to check status, or atlas-connect-cluster to connect (it will wait until the cluster is ready).`,
                    ].join("\n"),
                },
            ],
        };
    }
}
```

- [ ] **Step 2.2 — Run unit tests to verify they pass**

```bash
cd /Users/andrea.angiolillo/workspace/offsite/devTools-hackatone/fork/mongodb-mcp-server
pnpm vitest run --project unit-and-integration tests/unit/tools/atlas/create/createDedicatedCluster.test.ts
```

Expected: all tests pass.

- [ ] **Step 2.3 — Commit**

```bash
git add src/tools/atlas/create/createDedicatedCluster.ts tests/unit/tools/atlas/create/createDedicatedCluster.test.ts
git commit -m "feat: add atlas-create-dedicated-cluster tool with unit tests"
```

---

## Task 3: Register the tool

**Files:**
- Modify: `src/tools/atlas/tools.ts`

- [ ] **Step 3.1 — Add export line to tools.ts**

In `src/tools/atlas/tools.ts`, add after the `CreateFreeClusterTool` export line:

```typescript
export { CreateDedicatedClusterTool } from "./create/createDedicatedCluster.js";
```

- [ ] **Step 3.2 — Build to verify TypeScript compiles**

```bash
cd /Users/andrea.angiolillo/workspace/offsite/devTools-hackatone/fork/mongodb-mcp-server
pnpm run build
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3.3 — Commit**

```bash
git add src/tools/atlas/tools.ts
git commit -m "feat: register atlas-create-dedicated-cluster in tool registry"
```

---

## Task 4: Integration tests

**Files:**
- Modify: `tests/integration/tools/atlas/clusters.test.ts`

Integration tests run against cloud-dev and require `MDB_MCP_API_CLIENT_ID` / `MDB_MCP_API_CLIENT_SECRET`. They create real clusters (M10, takes 7–10 minutes) and are cleaned up in `afterAll`.

- [ ] **Step 4.1 — Add the integration test block**

In `tests/integration/tools/atlas/clusters.test.ts`, add a new `describe` block **inside** the existing `withProject(integration, ...)` callback, after the last existing `describe` block:

```typescript
describe("atlas-create-dedicated-cluster", () => {
    const dedicatedClusterName = "DedicatedClusterTest-" + randomId();

    afterAll(async () => {
        const projectId = getProjectId();
        if (projectId) {
            const session: Session = integration.mcpServer().session;
            await deleteCluster(session, projectId, dedicatedClusterName);
        }
    });

    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const tool = tools.find((t) => t.name === "atlas-create-dedicated-cluster");

        expectDefined(tool);
        expect(tool.inputSchema.type).toBe("object");
        expectDefined(tool.inputSchema.properties);
        expect(tool.inputSchema.properties).toHaveProperty("projectId");
        expect(tool.inputSchema.properties).toHaveProperty("name");
        expect(tool.inputSchema.properties).toHaveProperty("provider");
        expect(tool.inputSchema.properties).toHaveProperty("region");
        expect(tool.inputSchema.properties).toHaveProperty("instanceSize");
        expect(tool.inputSchema.properties).toHaveProperty("numShards");
        expect(tool.inputSchema.properties).toHaveProperty("backupEnabled");
        expect(tool.inputSchema.properties).toHaveProperty("pitEnabled");
    });

    it("should reject sharded cluster with instanceSize below M30", async () => {
        const projectId = getProjectId();
        const response = await integration.mcpClient().callTool({
            name: "atlas-create-dedicated-cluster",
            arguments: { projectId, name: dedicatedClusterName, numShards: 2, instanceSize: "M10" },
        });
        expect(response.isError).toBe(true);
        const content = getResponseContent(response.content);
        expect(content).toContain("M30");
    });

    it("should reject pitEnabled without backupEnabled", async () => {
        const projectId = getProjectId();
        const response = await integration.mcpClient().callTool({
            name: "atlas-create-dedicated-cluster",
            arguments: {
                projectId,
                name: dedicatedClusterName,
                pitEnabled: true,
                backupEnabled: false,
            },
        });
        expect(response.isError).toBe(true);
        const content = getResponseContent(response.content);
        expect(content).toContain("backupEnabled");
    });

    it("should create a replica set cluster", async () => {
        const projectId = getProjectId();
        const response = await integration.mcpClient().callTool({
            name: "atlas-create-dedicated-cluster",
            arguments: {
                projectId,
                name: dedicatedClusterName,
                provider: "AWS",
                region: "US_EAST_1",
                instanceSize: "M10",
            },
        });
        expect(response.isError).toBeFalsy();
        const content = getResponseContent(response.content);
        expect(content).toContain(dedicatedClusterName);
        expect(content).toContain("creation initiated");
        expect(content).toContain("REPLICASET");

        // Verify cluster exists in Atlas
        const session: Session = integration.mcpServer().session;
        assertApiClientIsAvailable(session);
        const cluster = await session.apiClient.getCluster({
            params: { path: { groupId: projectId, clusterName: dedicatedClusterName } },
        });
        expect(cluster.name).toBe(dedicatedClusterName);
    });
});
```

- [ ] **Step 4.2 — Run integration tests (metadata + validation only — no cluster creation)**

```bash
cd /Users/andrea.angiolillo/workspace/offsite/devTools-hackatone/fork/mongodb-mcp-server
pnpm vitest run --project unit-and-integration tests/integration/tools/atlas/clusters.test.ts -t "atlas-create-dedicated-cluster"
```

The metadata test and the two validation tests will pass immediately (no API calls for the validation tests). The creation test will pass if Atlas credentials are configured and will take 7-10 minutes.

- [ ] **Step 4.3 — Commit**

```bash
git add tests/integration/tools/atlas/clusters.test.ts
git commit -m "test: add integration tests for atlas-create-dedicated-cluster"
```

---

## Task 5: Sync the spec

**Files:**
- Modify: `docs/specs/2026-05-06-atlas-create-dedicated-cluster-design.md`

The spec's elicitation section describes all 4 fields (name, provider, region, instanceSize) as potentially triggering elicitation. The implementation elicits only `name`. Update the spec to match.

- [ ] **Step 5.1 — Update the Elicitation Flow section**

Replace the existing elicitation flow in the spec with:

```markdown
## Elicitation Flow

Only `name` triggers elicitation — it is the only argument without a sensible default. `provider`, `region`, and `instanceSize` have Zod defaults (`"AWS"`, `"US_EAST_1"`, `"M10"`) and are never absent.

```
execute() called
    │
    ├─ name present? ───────────────────────────────────────► Phase 2: Validate
    │
    └─ name missing?
          │
          ├─ supportsElicitation() = true
          │       │
          │       └─ show form: { name: "Cluster Name" }
          │               │
          │               ├─ accepted ──► fill name ──► Phase 2: Validate
          │               └─ cancelled ──► return "Operation cancelled."
          │
          └─ supportsElicitation() = false
                  │
                  └─ return structured missing-fields message:
                     "To create a dedicated cluster I need:
                      - name: cluster name (letters, numbers, hyphens)"
                     (Claude reads this and asks the user conversationally)
```
```

Also update the Args Shape table: remove `**yes**` from `provider`, `region`, and `instanceSize` in the **Elicited** column — change them to `no`.

- [ ] **Step 5.2 — Commit**

```bash
git add docs/specs/2026-05-06-atlas-create-dedicated-cluster-design.md
git commit -m "docs: sync spec elicitation section with Option A implementation"
```

---

## Self-Review Checklist

- [x] `backupEnabled` and `pitEnabled` — in argsShape, body builder, unit tests, integration tests ✓
- [x] `pitEnabled` without `backupEnabled` — validation + test ✓
- [x] `numShards > 1` + `instanceSize < M30` — validation + test ✓
- [x] `autoScalingMaxInstanceSize < instanceSize` — validation + test ✓
- [x] `versionReleaseSystem` + `mongoDBMajorVersion` — validation + test ✓
- [x] Elicitation for missing `name` — both paths (supported/not supported) + tests ✓
- [x] `additionalRegions` priorities — body builder + unit test ✓
- [x] `clusterType` derived from `numShards` — body builder + unit tests ✓
- [x] Fire-and-forget return message — unit test for content ✓
- [x] Tool registered in `tools.ts` — Task 3 ✓
- [x] Spec updated — Task 5 ✓
- [x] No placeholder steps — all steps have exact code ✓
- [x] Type names consistent across all tasks (`CreateDedicatedClusterTool`, `parseInstanceSizeNum`) ✓
