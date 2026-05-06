import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../src/tools/tool.js";
import type { Session } from "../../src/common/session.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import type { ApiClient } from "../../src/common/atlas/apiClient.js";
import { NullLogger } from "../../src/common/logging/index.js";
import { UIRegistry } from "../../src/ui/registry/index.js";
import { MockMetrics } from "./mocks/metrics.js";
import { CreateOneRegionClusterTool } from "../../src/tools/atlas/create/createOneRegionCluster.js";
import { CreateTwoRegionClusterTool } from "../../src/tools/atlas/create/createTwoRegionCluster.js";
import { CreateThreeRegionClusterTool } from "../../src/tools/atlas/create/createThreeRegionCluster.js";
import { PauseClusterTool } from "../../src/tools/atlas/cluster/pauseCluster.js";
import { ResumeClusterTool } from "../../src/tools/atlas/cluster/resumeCluster.js";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const CLUSTER_NAME = "my-cluster";
const ABORT_CTX = { signal: new AbortController().signal };

function buildParams(apiClient: Partial<ApiClient>, toolClass: { toolName: string; category: string; operationType: string }): ToolConstructorParams {
    return {
        name: toolClass.toolName,
        category: toolClass.category as never,
        operationType: toolClass.operationType as never,
        session: {
            apiClient,
            logger: new NullLogger(),
        } as unknown as Session,
        config: {
            confirmationRequiredTools: [],
            disabledTools: [],
            previewFeatures: [],
            apiClientId: "mock-id",
            apiClientSecret: "mock-secret",
        } as unknown as UserConfig,
        telemetry: {
            isTelemetryEnabled: () => false,
            emitEvents: vi.fn(),
        } as unknown as Telemetry,
        elicitation: {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation,
        uiRegistry: new UIRegistry(),
        metrics: new MockMetrics(),
    };
}

const SHARED_DEFAULTS = {
    clusterType: "REPLICASET" as const,
    provider: "AWS" as const,
    instanceSize: undefined,
    minInstanceSize: "M10" as const,
    maxInstanceSize: "M200" as const,
    backupEnabled: false,
    pitEnabled: false,
    diskSizeGb: undefined,
    diskGBEnabled: true,
    shardCount: undefined,
    tags: {},
    terminationProtectionEnabled: false,
};

describe("CreateOneRegionClusterTool", () => {
    let createCluster: ReturnType<typeof vi.fn>;
    let tool: CreateOneRegionClusterTool;

    beforeEach(() => {
        createCluster = vi.fn().mockResolvedValue(undefined);
        tool = new CreateOneRegionClusterTool(
            buildParams({ createCluster }, CreateOneRegionClusterTool)
        );
    });

    it("calls createCluster with correct body and returns success message", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        expect(createCluster).toHaveBeenCalledOnce();
        const [{ params, body }] = createCluster.mock.calls[0] as [{ params: { path: { groupId: string } }; body: Record<string, unknown> }];
        expect(params.path.groupId).toBe(PROJECT_ID);
        expect(body).toMatchObject({
            name: CLUSTER_NAME,
            clusterType: "REPLICASET",
            terminationProtectionEnabled: false,
            tags: [],
        });

        expect(result.isError).toBeFalsy();
        const texts = result.content.map((c) => (c as { text: string }).text);
        expect(texts.some((t) => t.includes(CLUSTER_NAME))).toBe(true);
        expect(texts.some((t) => t.includes("US_EAST_1"))).toBe(true);
        expect(texts.some((t) => t.toLowerCase().includes("access list"))).toBe(true);
    });

    it("passes tags as {key, value} array to the Atlas API", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                tags: { Environment: "prod", Team: "platform" },
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { tags: unknown[] } }];
        expect(body.tags).toEqual(
            expect.arrayContaining([
                { key: "Environment", value: "prod" },
                { key: "Team", value: "platform" },
            ])
        );
    });

    it("passes terminationProtectionEnabled through to body", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                terminationProtectionEnabled: true,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: Record<string, unknown> }];
        expect(body.terminationProtectionEnabled).toBe(true);
    });

    it("returns error when pitEnabled=true without backupEnabled", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                pitEnabled: true,
                backupEnabled: false,
            },
            ABORT_CTX
        );

        expect(result.isError).toBe(true);
        expect(createCluster).not.toHaveBeenCalled();
    });

    it("returns error when shardCount is set on REPLICASET", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                clusterType: "REPLICASET",
                shardCount: 2,
            },
            ABORT_CTX
        );

        expect(result.isError).toBe(true);
        expect(createCluster).not.toHaveBeenCalled();
    });

    it("creates multiple replicationSpecs for SHARDED cluster", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region: "US_EAST_1",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                clusterType: "SHARDED",
                shardCount: 2,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: unknown[] } }];
        expect(body.replicationSpecs).toHaveLength(2);
    });
});

describe("CreateTwoRegionClusterTool", () => {
    let createCluster: ReturnType<typeof vi.fn>;
    let tool: CreateTwoRegionClusterTool;

    beforeEach(() => {
        createCluster = vi.fn().mockResolvedValue(undefined);
        tool = new CreateTwoRegionClusterTool(
            buildParams({ createCluster }, CreateTwoRegionClusterTool)
        );
    });

    it("creates a 5-node cluster with 3+2 fixed split across two regions", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "EU_WEST_1",
                provider2: undefined,
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ electableSpecs: { nodeCount: number }; regionName: string }> }> } }];
        const [spec] = body.replicationSpecs;
        expect(spec.regionConfigs).toHaveLength(2);
        expect(spec.regionConfigs[0]).toMatchObject({ regionName: "US_EAST_1", electableSpecs: { nodeCount: 3 } });
        expect(spec.regionConfigs[1]).toMatchObject({ regionName: "EU_WEST_1", electableSpecs: { nodeCount: 2 } });
    });

    it("uses provider2 override for region2 when provided", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "northeurope",
                provider2: "AZURE",
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ providerName: string }> }> } }];
        expect(body.replicationSpecs[0].regionConfigs[1].providerName).toBe("AZURE");
    });

    it("falls back to primary provider for region2 when provider2 is omitted", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "EU_WEST_1",
                provider2: undefined,
                ...SHARED_DEFAULTS,
                provider: "GCP",
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ providerName: string }> }> } }];
        expect(body.replicationSpecs[0].regionConfigs[1].providerName).toBe("GCP");
    });

    it("returns error when pitEnabled=true without backupEnabled", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "EU_WEST_1",
                provider2: undefined,
                ...SHARED_DEFAULTS,
                pitEnabled: true,
                backupEnabled: false,
            },
            ABORT_CTX
        );
        expect(result.isError).toBe(true);
        expect(createCluster).not.toHaveBeenCalled();
    });

    it("success message mentions both regions and fixed node split", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "EU_WEST_1",
                provider2: undefined,
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        const texts = result.content.map((c) => (c as { text: string }).text).join(" ");
        expect(texts).toContain("US_EAST_1");
        expect(texts).toContain("EU_WEST_1");
        expect(texts.toLowerCase()).toContain("access list");
    });
});

describe("CreateThreeRegionClusterTool", () => {
    let createCluster: ReturnType<typeof vi.fn>;
    let tool: CreateThreeRegionClusterTool;

    beforeEach(() => {
        createCluster = vi.fn().mockResolvedValue(undefined);
        tool = new CreateThreeRegionClusterTool(
            buildParams({ createCluster }, CreateThreeRegionClusterTool)
        );
    });

    it("creates a 9-node cluster across three regions", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "US_EAST_2",
                region3: "US_WEST_2",
                provider2: undefined,
                provider3: undefined,
                nodeCount: 3,
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ regionName: string; electableSpecs: { nodeCount: number } }> }> } }];
        const [spec] = body.replicationSpecs;
        expect(spec.regionConfigs).toHaveLength(3);
        expect(spec.regionConfigs[0]).toMatchObject({ regionName: "US_EAST_1", electableSpecs: { nodeCount: 3 } });
        expect(spec.regionConfigs[1]).toMatchObject({ regionName: "US_EAST_2", electableSpecs: { nodeCount: 3 } });
        expect(spec.regionConfigs[2]).toMatchObject({ regionName: "US_WEST_2", electableSpecs: { nodeCount: 3 } });
    });

    it("assigns descending priorities to the three regions", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "US_EAST_2",
                region3: "US_WEST_2",
                provider2: undefined,
                provider3: undefined,
                nodeCount: 3,
                ...SHARED_DEFAULTS,
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ priority: number }> }> } }];
        const priorities = body.replicationSpecs[0].regionConfigs.map((c) => c.priority);
        expect(priorities).toEqual([7, 6, 5]);
    });

    it("applies per-region provider overrides", async () => {
        await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "northeurope",
                region3: "japaneast",
                provider2: "AZURE",
                provider3: "AZURE",
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                provider: "AWS",
            },
            ABORT_CTX
        );

        const [{ body }] = createCluster.mock.calls[0] as [{ body: { replicationSpecs: Array<{ regionConfigs: Array<{ providerName: string }> }> } }];
        const providers = body.replicationSpecs[0].regionConfigs.map((c) => c.providerName);
        expect(providers).toEqual(["AWS", "AZURE", "AZURE"]);
    });

    it("returns error when pitEnabled=true without backupEnabled", async () => {
        const result = await tool.invoke(
            {
                projectId: PROJECT_ID,
                name: CLUSTER_NAME,
                region1: "US_EAST_1",
                region2: "US_EAST_2",
                region3: "US_WEST_2",
                provider2: undefined,
                provider3: undefined,
                nodeCount: 3,
                ...SHARED_DEFAULTS,
                pitEnabled: true,
                backupEnabled: false,
            },
            ABORT_CTX
        );
        expect(result.isError).toBe(true);
        expect(createCluster).not.toHaveBeenCalled();
    });
});

describe("PauseClusterTool", () => {
    let updateCluster: ReturnType<typeof vi.fn>;
    let tool: PauseClusterTool;

    beforeEach(() => {
        updateCluster = vi.fn().mockResolvedValue(undefined);
        tool = new PauseClusterTool(buildParams({ updateCluster }, PauseClusterTool));
    });

    it("calls updateCluster with paused=true", async () => {
        const result = await tool.invoke(
            { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            ABORT_CTX
        );

        expect(updateCluster).toHaveBeenCalledWith(PROJECT_ID, CLUSTER_NAME, { paused: true });
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain(CLUSTER_NAME);
        expect(text.toLowerCase()).toContain("paus");
    });
});

describe("ResumeClusterTool", () => {
    let updateCluster: ReturnType<typeof vi.fn>;
    let tool: ResumeClusterTool;

    beforeEach(() => {
        updateCluster = vi.fn().mockResolvedValue(undefined);
        tool = new ResumeClusterTool(buildParams({ updateCluster }, ResumeClusterTool));
    });

    it("calls updateCluster with paused=false", async () => {
        const result = await tool.invoke(
            { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            ABORT_CTX
        );

        expect(updateCluster).toHaveBeenCalledWith(PROJECT_ID, CLUSTER_NAME, { paused: false });
        expect(result.isError).toBeFalsy();
        const text = (result.content[0] as { text: string }).text;
        expect(text).toContain(CLUSTER_NAME);
        expect(text.toLowerCase()).toContain("resum");
    });
});
