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

        it("produces 3 independent replicationSpecs entries for numShards: 3", async () => {
            await exec({ ...baseArgs, numShards: 3, instanceSize: "M30", autoScalingMaxInstanceSize: "M40" });
            const body = mockApiClient.createCluster.mock.calls[0][0].body;
            expect(body.clusterType).toBe("SHARDED");
            expect(body.replicationSpecs).toHaveLength(3);
            // Verify entries are independent objects (not shared references)
            expect(body.replicationSpecs[0]).not.toBe(body.replicationSpecs[1]);
            expect(body.replicationSpecs[0].regionConfigs[0].regionName).toBe("US_EAST_1");
            expect(body.replicationSpecs[1].regionConfigs[0].regionName).toBe("US_EAST_1");
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

        it("returns 'Operation cancelled.' when elicitation returns empty name", async () => {
            mockElicitation.supportsElicitation.mockReturnValue(true);
            mockElicitation.requestInput.mockResolvedValue({
                accepted: true,
                fields: { name: "" },
            });
            const result = await exec({ ...baseArgs, name: undefined });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toBe("Operation cancelled.");
            expect(mockApiClient.createCluster).not.toHaveBeenCalled();
        });
    });
});
