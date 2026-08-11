import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { UpgradeClusterTool } from "../../../../../src/tools/atlas/update/upgradeCluster.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { ApiClientError } from "../../../../../src/common/atlas/apiClientError.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import type { Keychain } from "../../../../../src/lib.js";

function notFoundError(): ApiClientError {
    return ApiClientError.fromError(new Response(null, { status: 404, statusText: "Not Found" }), "cluster not found");
}

function flexOnRegularApiError(): ApiClientError {
    return ApiClientError.fromError(
        new Response(null, { status: 400, statusText: "Bad Request" }),
        "Flex cluster cannot be used in the Cluster API"
    );
}

const FREE_CLUSTER_RAW = {
    id: "free-cluster-id",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    backingProviderName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M0" },
                },
            ],
        },
    ],
};

const DEDICATED_CLUSTER_RAW = {
    id: "dedicated-cluster-id",
    clusterType: "REPLICASET",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M10" },
                },
            ],
        },
    ],
};

const DEDICATED_CLUSTER_WITH_AUTOSCALING_RAW = {
    id: "dedicated-cluster-id",
    clusterType: "REPLICASET",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M20" },
                    autoScaling: {
                        compute: { enabled: true, minInstanceSize: "M20", maxInstanceSize: "M40" },
                    },
                },
            ],
        },
    ],
};

const DEDICATED_CLUSTER_MULTI_REGION_RAW = {
    id: "dedicated-cluster-id",
    clusterType: "REPLICASET",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M10" },
                },
                {
                    providerName: "AWS",
                    regionName: "US_WEST_2",
                    readOnlySpecs: { instanceSize: "M10" },
                },
                {
                    providerName: "AWS",
                    regionName: "EU_WEST_1",
                    analyticsSpecs: { instanceSize: "M10" },
                },
            ],
        },
    ],
};

const DEDICATED_CLUSTER_M80_RAW = {
    id: "dedicated-cluster-id",
    clusterType: "REPLICASET",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M80" },
                },
            ],
        },
    ],
};

const DEDICATED_CLUSTER_NVME_RAW = {
    id: "dedicated-cluster-id",
    clusterType: "REPLICASET",
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M40_NVME" },
                },
            ],
        },
    ],
};

const FLEX_CLUSTER_RAW = {
    id: "flex-cluster-id",
    providerSettings: {
        backingProviderName: "AWS",
        regionName: "US_EAST_1",
    },
};

const UPGRADE_RESULT = { id: "upgraded-cluster-id" };

describe("UpgradeClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<Session>;
    let tool: UpgradeClusterTool;

    function buildTool(): UpgradeClusterTool {
        mockApiClient = {
            getCluster: vi.fn(),
            getFlexCluster: vi.fn(),
            upgradeTenantUpgrade: vi.fn().mockResolvedValue(UPGRADE_RESULT),
            tenantUpgrade: vi.fn().mockResolvedValue(UPGRADE_RESULT),
            updateCluster: vi.fn().mockResolvedValue(UPGRADE_RESULT),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        mockSession = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            keychain: { allSecrets: [] } as unknown as Keychain,
        };

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

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: UpgradeClusterTool.toolName,
            category: "atlas",
            operationType: UpgradeClusterTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new UpgradeClusterTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["invoke"](args as never, {} as never);

    beforeEach(() => {
        tool = buildTool();
    });

    describe("error cases", () => {
        it("requires projectId and clusterName in the args schema", () => {
            const schema = z.object(tool.argsShape);

            expect(schema.safeParse({}).success).toBe(false);
            expect(schema.safeParse({ projectId: "507f1f77bcf86cd799439011" }).success).toBe(false);
            expect(schema.safeParse({ projectId: "507f1f77bcf86cd799439011", clusterName: "MyCluster" }).success).toBe(
                true
            );
        });

        it("returns error for DEDICATED cluster with no scale args provided", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("No changes specified");
        });

        it("returns error when attempting to upgrade FLEX to FLEX", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "FLEX" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already a Flex cluster");
        });

        it("returns error for non-404 getCluster failure without falling through to getFlexCluster", async () => {
            const serverError = ApiClientError.fromError(
                new Response(null, { status: 500, statusText: "Internal Server Error" }),
                "internal server error"
            );
            mockApiClient.getCluster!.mockRejectedValue(serverError);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(result.isError).toBe(true);
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });

        it("returns error for plain getCluster failure without falling through to getFlexCluster", async () => {
            mockApiClient.getCluster!.mockRejectedValue(new Error("network timeout"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(result.isError).toBe(true);
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });

        it("returns error when upgradeTenantUpgrade throws (FREE to FLEX)", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            mockApiClient.upgradeTenantUpgrade!.mockRejectedValue(new Error("upgrade quota exceeded"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(result.isError).toBe(true);
        });

        it("returns error when upgradeTenantUpgrade throws (FREE to M10)", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            mockApiClient.upgradeTenantUpgrade!.mockRejectedValue(new Error("upgrade quota exceeded"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });
            expect(result.isError).toBe(true);
        });

        it("returns error when tenantUpgrade throws", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);
            mockApiClient.tenantUpgrade!.mockRejectedValue(new Error("upgrade quota exceeded"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(result.isError).toBe(true);
        });

        it("returns error when targetTier is FLEX for a DEDICATED cluster", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "FLEX",
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already Dedicated");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when provider is provided for a DEDICATED cluster", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M20",
                provider: "GCP",
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("not valid when scaling an already-Dedicated cluster");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when region is provided for a DEDICATED cluster", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M20",
                region: "US_WEST_2",
            });

            expect(result.isError).toBe(true);
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when current instance size is an NVMe variant", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_NVME_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M50" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("does not support scaling");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when updateCluster throws", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);
            mockApiClient.updateCluster!.mockRejectedValue(new Error("update failed"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
        });

        it("accepts a SHARDED cluster with a single shard, same as a REPLICASET", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "SHARDED",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.updateCluster).toHaveBeenCalled();
        });

        it("returns error when the cluster is GEOSHARDED", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "GEOSHARDED",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "EU_WEST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("GEOSHARDED");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when the cluster has multiple shards", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "SHARDED",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("returns error when targetTier is an instance size for a FREE source", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain('targetTier "M20" is not valid');
            expect(mockApiClient.upgradeTenantUpgrade).not.toHaveBeenCalled();
        });

        it("returns error when targetTier is an instance size for a FLEX source", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
            expect(mockApiClient.tenantUpgrade).not.toHaveBeenCalled();
        });

        it("returns error when computeAutoScaling is provided for a FREE-to-FLEX upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                computeAutoScaling: true,
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("Flex clusters do not support compute autoscaling");
            expect(mockApiClient.upgradeTenantUpgrade).not.toHaveBeenCalled();
        });

        it("returns error when minInstanceSize/maxInstanceSize provided for an explicit FLEX target", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "FLEX",
                minInstanceSize: "M20",
            });

            expect(result.isError).toBe(true);
        });

        it("returns error when minInstanceSize is not M10 for a Free/Flex-to-M10 upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M10",
                minInstanceSize: "M20",
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain('must be omitted or "M10"');
            expect(mockApiClient.upgradeTenantUpgrade).not.toHaveBeenCalled();
        });
    });

    describe("FREE cluster", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
        });

        it("upgrades FREE to FLEX by default", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to FLEX");

            expect(mockApiClient.upgradeTenantUpgrade).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "MyCluster",
                        providerSettings: {
                            providerName: "FLEX",
                            instanceSizeName: "FLEX",
                            backingProviderName: "AWS",
                            regionName: "US_EAST_1",
                        },
                    },
                },
                expect.anything()
            );
        });

        it("upgrades FREE to M10 when targetTier is M10", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to M10");

            expect(mockApiClient.upgradeTenantUpgrade).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "MyCluster",
                        providerSettings: {
                            providerName: "AWS",
                            instanceSizeName: "M10",
                            regionName: "US_EAST_1",
                            autoScaling: {
                                compute: {
                                    minInstanceSize: "M10",
                                    maxInstanceSize: "M30",
                                },
                            },
                        },
                        autoScaling: {
                            compute: {
                                enabled: true,
                                scaleDownEnabled: true,
                            },
                            diskGBEnabled: true,
                        },
                    },
                },
                expect.anything()
            );
        });

        it("uses provided provider and region overrides for FREE to FLEX", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.upgradeTenantUpgrade).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "MyCluster",
                        providerSettings: {
                            providerName: "FLEX",
                            instanceSizeName: "FLEX",
                            backingProviderName: "GCP",
                            regionName: "CENTRAL_US",
                        },
                    },
                },
                expect.anything()
            );
        });

        it("uses provided provider and region overrides for FREE to M10", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M10",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.upgradeTenantUpgrade).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "MyCluster",
                        providerSettings: {
                            providerName: "GCP",
                            instanceSizeName: "M10",
                            regionName: "CENTRAL_US",
                            autoScaling: {
                                compute: {
                                    minInstanceSize: "M10",
                                    maxInstanceSize: "M30",
                                },
                            },
                        },
                        autoScaling: {
                            compute: {
                                enabled: true,
                                scaleDownEnabled: true,
                            },
                            diskGBEnabled: true,
                        },
                    },
                },
                expect.anything()
            );
        });

        it("omits regionName when cluster has no region", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "free-cluster-id",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            {
                                backingProviderName: "AWS",
                                electableSpecs: { instanceSize: "M0" },
                            },
                        ],
                    },
                ],
            });

            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const call = mockApiClient.upgradeTenantUpgrade!.mock.calls[0]![0] as {
                body: { providerSettings: { regionName?: string } };
            };
            expect(call.body.providerSettings.regionName).toBeUndefined();
        });

        it("does not call getFlexCluster for FREE clusters", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });
    });

    describe("FLEX cluster", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);
        });

        it("upgrades FLEX to M10 by default", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FLEX to M10");

            expect(mockApiClient.tenantUpgrade).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "proj1" } },
                    body: {
                        name: "MyCluster",
                        clusterType: "REPLICASET",
                        replicationSpecs: [
                            {
                                regionConfigs: [
                                    {
                                        providerName: "AWS",
                                        regionName: "US_EAST_1",
                                        priority: 7,
                                        electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                                        autoScaling: {
                                            compute: {
                                                enabled: true,
                                                scaleDownEnabled: true,
                                                minInstanceSize: "M10",
                                                maxInstanceSize: "M30",
                                            },
                                            diskGB: { enabled: true },
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
                expect.anything()
            );
        });

        it("uses provided provider and region overrides for FLEX to M10", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.tenantUpgrade!.mock.calls[0]![0] as {
                body: {
                    replicationSpecs: Array<{ regionConfigs: Array<{ providerName?: string; regionName?: string }> }>;
                };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.providerName).toBe("GCP");
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.regionName).toBe("CENTRAL_US");
        });

        it("omits providerName and regionName from replicationSpec when flex cluster has no provider/region", async () => {
            mockApiClient.getFlexCluster!.mockResolvedValue({ id: "flex-cluster-id" });

            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const call = mockApiClient.tenantUpgrade!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!["providerName"]).toBeUndefined();
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!["regionName"]).toBeUndefined();
        });

        it("falls back to getFlexCluster when getCluster throws 404", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(mockApiClient.getCluster).toHaveBeenCalledTimes(1);
            expect(mockApiClient.getFlexCluster).toHaveBeenCalledTimes(1);
        });

        it("falls back to getFlexCluster when getCluster throws 400 (Flex cluster on regular API)", async () => {
            mockApiClient.getCluster!.mockRejectedValue(flexOnRegularApiError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.getFlexCluster).toHaveBeenCalledTimes(1);
        });
    });

    describe("structuredContent", () => {
        it("returns originalTier=free and targetTier=flex for FREE to FLEX upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({ originalTier: "FREE", targetTier: "FLEX" });
        });

        it("returns originalTier=FREE, targetTier=M10 for FREE to M10 upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.structuredContent).toMatchObject({
                originalTier: "FREE",
                targetTier: "M10",
            });
        });

        it("returns originalTier=FLEX, targetTier=M10 for FLEX to M10 upgrade", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({
                originalTier: "FLEX",
                targetTier: "M10",
            });
        });

        it("includes provider and region when provided as args", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.structuredContent).toMatchObject({ resolvedProvider: "GCP", resolvedRegion: "CENTRAL_US" });
        });

        it("includes provider and region from cluster fetch when not provided as args", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({ resolvedProvider: "AWS", resolvedRegion: "US_EAST_1" });
        });

        it("omits provider and region when cluster has no provider data", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "free-cluster-id",
                replicationSpecs: [{ regionConfigs: [{ electableSpecs: { instanceSize: "M0" } }] }],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect((result.structuredContent as Record<string, unknown>)["resolvedProvider"]).toBeUndefined();
            expect((result.structuredContent as Record<string, unknown>)["resolvedRegion"]).toBeUndefined();
        });

        it("includes clusterId from the upgrade response", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({
                clusterId: "upgraded-cluster-id",
            });
        });

        it("successive calls return independent structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const firstResult = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(firstResult.structuredContent).toMatchObject({ originalTier: "FREE" });

            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);
            const secondResult = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(secondResult.structuredContent).toMatchObject({ originalTier: "FLEX" });
        });
    });

    describe("DEDICATED cluster", () => {
        it("scales instance size only, preserving disabled autoscaling", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!["electableSpecs"]).toMatchObject({
                instanceSize: "M20",
            });
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!["autoScaling"]).toMatchObject({
                compute: { enabled: false, scaleDownEnabled: false },
            });
        });

        it("leaves analytics-only region configs untouched", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_MULTI_REGION_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            const regionConfigs = call.body.replicationSpecs[0]!.regionConfigs;
            expect(regionConfigs[0]!["electableSpecs"]).toMatchObject({ instanceSize: "M20" });
            expect(regionConfigs[1]!["readOnlySpecs"]).toMatchObject({ instanceSize: "M20" });
            expect(regionConfigs[2]!["analyticsSpecs"]).toMatchObject({ instanceSize: "M10" });
            expect(regionConfigs[2]!["autoScaling"]).toBeUndefined();
        });

        it("scales electable and readOnly specs but not analytics when a single region has all three", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "REPLICASET",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            {
                                providerName: "AWS",
                                regionName: "US_EAST_1",
                                electableSpecs: { instanceSize: "M10" },
                                analyticsSpecs: { instanceSize: "M10" },
                            },
                            {
                                providerName: "AWS",
                                regionName: "US_WEST_2",
                                electableSpecs: { instanceSize: "M10" },
                                readOnlySpecs: { instanceSize: "M10" },
                                analyticsSpecs: { instanceSize: "M10" },
                            },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            const regionConfigs = call.body.replicationSpecs[0]!.regionConfigs;
            expect(regionConfigs[0]!["electableSpecs"]).toMatchObject({ instanceSize: "M20" });
            expect(regionConfigs[0]!["analyticsSpecs"]).toMatchObject({ instanceSize: "M10" });
            expect(regionConfigs[1]!["electableSpecs"]).toMatchObject({ instanceSize: "M20" });
            expect(regionConfigs[1]!["readOnlySpecs"]).toMatchObject({ instanceSize: "M20" });
            expect(regionConfigs[1]!["analyticsSpecs"]).toMatchObject({ instanceSize: "M10" });
        });

        it("omits diskGB from the request body when the cluster had no existing diskGB config", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            const autoScaling = call.body.replicationSpecs[0]!.regionConfigs[0]!["autoScaling"] as Record<
                string,
                unknown
            >;
            expect(autoScaling["diskGB"]).toBeUndefined();
        });

        it("enables autoscaling with no bounds, defaulting min to size and max two tiers above", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", computeAutoScaling: true });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                targetTier: "M10",
                computeAutoScaling: true,
                minInstanceSize: "M10",
                maxInstanceSize: "M30",
            });
        });

        it("defaults the autoscaling max for M80 to M200, matching createCluster's convention", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_M80_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", computeAutoScaling: true });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                targetTier: "M80",
                maxInstanceSize: "M200",
            });
        });

        it("enables autoscaling with explicit min/max, explicit values win", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                computeAutoScaling: true,
                minInstanceSize: "M20",
                maxInstanceSize: "M50",
            });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                computeAutoScaling: true,
                minInstanceSize: "M20",
                maxInstanceSize: "M50",
            });
        });

        it("disables autoscaling while passing min/max, bounds still present in request body", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_WITH_AUTOSCALING_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                computeAutoScaling: false,
                minInstanceSize: "M20",
                maxInstanceSize: "M40",
            });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!["autoScaling"]).toMatchObject({
                compute: {
                    enabled: false,
                    scaleDownEnabled: false,
                    minInstanceSize: "M20",
                    maxInstanceSize: "M40",
                },
            });
        });

        it("changes only min/max, preserving current enabled state", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_WITH_AUTOSCALING_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", maxInstanceSize: "M50" });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                computeAutoScaling: true,
                minInstanceSize: "M20",
                maxInstanceSize: "M50",
            });
        });

        it("recomputes min/max relative to the new size when resizing, instead of inheriting stale values", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_WITH_AUTOSCALING_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M30" });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                targetTier: "M30",
                computeAutoScaling: true,
                minInstanceSize: "M30",
                maxInstanceSize: "M50",
            });
        });

        it("preserves the existing max when resizing if it's already higher than the new default", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "REPLICASET",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            {
                                providerName: "AWS",
                                regionName: "US_EAST_1",
                                electableSpecs: { instanceSize: "M20" },
                                autoScaling: {
                                    compute: { enabled: true, minInstanceSize: "M20", maxInstanceSize: "M60" },
                                },
                            },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M30" });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({
                targetTier: "M30",
                minInstanceSize: "M30",
                maxInstanceSize: "M60",
            });
        });

        it("mentions both size and autoscaling in the response text when both change", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M20",
                computeAutoScaling: true,
            });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("scaled to M20");
            expect(text).toContain("compute autoscaling enabled");
        });

        it("mentions only autoscaling in the response text when size is unchanged", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", computeAutoScaling: false });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).not.toContain("scaled to");
            expect(text).toContain("compute autoscaling disabled");
        });

        it("does not treat passing the current instance size as targetTier as a resize", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_WITH_AUTOSCALING_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).not.toContain("scaled to");
            expect(text).toContain("is being updated");
            // Existing min/max should be preserved, not reset relative to the "new" (unchanged) size.
            expect(result.structuredContent).toMatchObject({
                targetTier: "M20",
                minInstanceSize: "M20",
                maxInstanceSize: "M40",
            });
        });

        it("returns error when the cluster has an unrecognized clusterType", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                id: "dedicated-cluster-id",
                clusterType: "SOME_FUTURE_TYPE",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            { providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } },
                        ],
                    },
                ],
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M20" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("SOME_FUTURE_TYPE");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });
    });

    describe("cross-path argument validation", () => {
        it("FREE to M10 with computeAutoScaling=false disables autoscaling in the request body", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M10",
                computeAutoScaling: false,
            });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.upgradeTenantUpgrade!.mock.calls[0]![0] as {
                body: {
                    autoScaling: { compute: { enabled: boolean; minInstanceSize?: string; maxInstanceSize?: string } };
                };
            };
            expect(call.body.autoScaling.compute).toMatchObject({ enabled: false });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("compute autoscaling disabled");
        });

        it("FREE to M10 upgrade omits autoscaling detail from the response text when not requested", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).not.toContain("compute autoscaling");
        });

        it("FREE to M10 with explicit minInstanceSize/maxInstanceSize uses those instead of hardcoded M10/M30", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                targetTier: "M10",
                minInstanceSize: "M10",
                maxInstanceSize: "M40",
            });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.upgradeTenantUpgrade!.mock.calls[0]![0] as {
                body: { providerSettings: { autoScaling: { compute: { maxInstanceSize?: string } } } };
            };
            expect(call.body.providerSettings.autoScaling.compute.maxInstanceSize).toBe("M40");
        });

        it("FREE to M10 with no autoscaling args defaults to enabled, M10-M30", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.upgradeTenantUpgrade!.mock.calls[0]![0] as {
                body: {
                    autoScaling: { compute: { enabled: boolean } };
                    providerSettings: {
                        autoScaling: { compute: { minInstanceSize?: string; maxInstanceSize?: string } };
                    };
                };
            };
            expect(call.body.autoScaling.compute).toMatchObject({ enabled: true });
            expect(call.body.providerSettings.autoScaling.compute).toMatchObject({
                minInstanceSize: "M10",
                maxInstanceSize: "M30",
            });
        });
    });

    describe("telemetry metadata", () => {
        it("resolves originalTier, targetTier, and cluster_id from structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const metadata = await tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: result as never }
            );
            expect(metadata.original_tier).toBe("free");
            expect(metadata.target_tier).toBe("flex");
            expect(metadata.cluster_id).toBe("upgraded-cluster-id");
        });

        it("resolves provider and region from structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            const metadata = await tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster", provider: "GCP", region: "CENTRAL_US" } as never,
                { result: result as never }
            );
            expect(metadata.provider).toBe("GCP");
            expect(metadata.region).toBe("CENTRAL_US");
        });

        it("returns empty metadata fields when result has no structuredContent (error path)", async () => {
            const metadata = await tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: { content: [] } as never }
            );
            expect(metadata.original_tier).toBeUndefined();
            expect(metadata.target_tier).toBeUndefined();
        });
    });
});
