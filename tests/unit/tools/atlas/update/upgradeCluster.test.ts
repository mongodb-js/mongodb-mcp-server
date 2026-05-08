import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { UpgradeClusterTool } from "../../../../../src/tools/atlas/update/upgradeCluster.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { ApiClientError } from "../../../../../src/common/atlas/apiClientError.js";
import type { AtlasClusterConnectionInfo } from "../../../../../src/common/connectionInfo.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

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

    function buildTool(connectedCluster?: AtlasClusterConnectionInfo): UpgradeClusterTool {
        mockApiClient = {
            getCluster: vi.fn(),
            getFlexCluster: vi.fn(),
            upgradeSharedTierCluster: vi.fn().mockResolvedValue(UPGRADE_RESULT),
            upgradeFlexToDedicated: vi.fn().mockResolvedValue(UPGRADE_RESULT),
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
            connectedAtlasCluster: connectedCluster,
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
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    beforeEach(() => {
        tool = buildTool();
    });

    describe("error cases", () => {
        it("returns error when projectId and clusterName are missing and not connected", async () => {
            const result = await tool["invoke"]({} as never, {} as never);

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("projectId and clusterName are required");
        });

        it("returns error when only projectId is provided and not connected", async () => {
            const result = await tool["invoke"]({ projectId: "proj1" } as never, {} as never);

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("projectId and clusterName are required");
        });

        it("returns error for DEDICATED cluster when not connected", async () => {
            mockApiClient.getCluster!.mockResolvedValue(DEDICATED_CLUSTER_RAW);

            const result = await tool["invoke"]({ projectId: "proj1", clusterName: "MyCluster" } as never, {} as never);

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already at the Dedicated tier");
        });

        it("returns error for DEDICATED cluster when connected", async () => {
            const connectedCluster: AtlasClusterConnectionInfo = {
                username: "user",
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceType: "DEDICATED",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            };
            tool = buildTool(connectedCluster);

            const result = await tool["invoke"]({ projectId: "proj1", clusterName: "MyCluster" } as never, {} as never);

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already at the Dedicated tier");
            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
        });

        it("returns error when attempting to upgrade FLEX to FLEX (not connected)", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await tool["invoke"](
                { projectId: "proj1", clusterName: "MyCluster", targetTier: "FLEX" } as never,
                {} as never
            );

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already a Flex cluster");
        });

        it("returns error when attempting to upgrade FLEX to FLEX (connected)", async () => {
            const connectedCluster: AtlasClusterConnectionInfo = {
                username: "user",
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceType: "FLEX",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            };
            tool = buildTool(connectedCluster);

            const result = await tool["invoke"](
                { projectId: "proj1", clusterName: "MyCluster", targetTier: "FLEX" } as never,
                {} as never
            );

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("already a Flex cluster");
            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
        });
    });

    describe("not connected — FREE cluster", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
        });

        it("upgrades FREE to FLEX by default", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to FLEX");

            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith({
                groupId: "proj1",
                body: {
                    name: "MyCluster",
                    providerSettings: {
                        providerName: "FLEX",
                        instanceSizeName: "FLEX",
                        backingProviderName: "AWS",
                        regionName: "US_EAST_1",
                    },
                },
            });
        });

        it("upgrades FREE to M10 when targetTier is M10", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to M10");

            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith({
                groupId: "proj1",
                body: {
                    name: "MyCluster",
                    providerSettings: {
                        providerName: "AWS",
                        instanceSizeName: "M10",
                        regionName: "US_EAST_1",
                    },
                },
            });
        });

        it("uses provided provider and region overrides for FREE to FLEX", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith({
                groupId: "proj1",
                body: {
                    name: "MyCluster",
                    providerSettings: {
                        providerName: "FLEX",
                        instanceSizeName: "FLEX",
                        backingProviderName: "GCP",
                        regionName: "CENTRAL_US",
                    },
                },
            });
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
            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith({
                groupId: "proj1",
                body: {
                    name: "MyCluster",
                    providerSettings: {
                        providerName: "GCP",
                        instanceSizeName: "M10",
                        regionName: "CENTRAL_US",
                    },
                },
            });
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

            const call = mockApiClient.upgradeSharedTierCluster!.mock.calls[0]![0] as {
                body: { providerSettings: { regionName?: string } };
            };
            expect(call.body.providerSettings.regionName).toBeUndefined();
        });

        it("does not call getFlexCluster for FREE clusters", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });
    });

    describe("not connected — FLEX cluster", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);
        });

        it("upgrades FLEX to M10 by default", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FLEX to M10");

            expect(mockApiClient.upgradeFlexToDedicated).toHaveBeenCalledWith({
                groupId: "proj1",
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
                                },
                            ],
                        },
                    ],
                    autoScaling: {
                        compute: {
                            enabled: true,
                            scaleDownEnabled: true,
                            minInstanceSize: "M10",
                            maxInstanceSize: "M30",
                        },
                        diskGBEnabled: true,
                    },
                },
            });
        });

        it("uses provided provider and region overrides for FLEX to M10", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            expect(result.isError).toBeFalsy();
            const call = mockApiClient.upgradeFlexToDedicated!.mock.calls[0]![0] as {
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

            const call = mockApiClient.upgradeFlexToDedicated!.mock.calls[0]![0] as {
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

    describe("API failure handling", () => {
        it("propagates non-404 error from getCluster without falling through to getFlexCluster", async () => {
            const serverError = ApiClientError.fromError(
                new Response(null, { status: 500, statusText: "Internal Server Error" }),
                "internal server error"
            );
            mockApiClient.getCluster!.mockRejectedValue(serverError);

            await expect(exec({ projectId: "proj1", clusterName: "MyCluster" })).rejects.toThrow();
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });

        it("propagates plain errors from getCluster without falling through to getFlexCluster", async () => {
            mockApiClient.getCluster!.mockRejectedValue(new Error("network timeout"));

            await expect(exec({ projectId: "proj1", clusterName: "MyCluster" })).rejects.toThrow("network timeout");
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
        });

        it("propagates error when upgradeSharedTierCluster throws (FREE to FLEX)", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            mockApiClient.upgradeSharedTierCluster!.mockRejectedValue(new Error("upgrade quota exceeded"));

            await expect(exec({ projectId: "proj1", clusterName: "MyCluster" })).rejects.toThrow(
                "upgrade quota exceeded"
            );
        });

        it("propagates error when upgradeSharedTierCluster throws (FREE to M10)", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            mockApiClient.upgradeSharedTierCluster!.mockRejectedValue(new Error("upgrade quota exceeded"));

            await expect(exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" })).rejects.toThrow(
                "upgrade quota exceeded"
            );
        });

        it("propagates error when upgradeFlexToDedicated throws", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);
            mockApiClient.upgradeFlexToDedicated!.mockRejectedValue(new Error("upgrade quota exceeded"));

            await expect(exec({ projectId: "proj1", clusterName: "MyCluster" })).rejects.toThrow(
                "upgrade quota exceeded"
            );
        });
    });

    describe("connected — FREE cluster", () => {
        const connectedFreeCluster: AtlasClusterConnectionInfo = {
            username: "user",
            projectId: "proj1",
            clusterName: "MyCluster",
            instanceType: "FREE",
            provider: "AWS",
            region: "US_EAST_1",
            expiryDate: new Date(),
        };

        beforeEach(() => {
            tool = buildTool(connectedFreeCluster);
        });

        it("upgrades FREE to FLEX by default without fetching cluster", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to FLEX");

            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith({
                groupId: "proj1",
                body: {
                    name: "MyCluster",
                    providerSettings: {
                        providerName: "FLEX",
                        instanceSizeName: "FLEX",
                        backingProviderName: "AWS",
                        regionName: "US_EAST_1",
                    },
                },
            });
        });

        it("upgrades FREE to M10 when targetTier is M10 without fetching cluster", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FREE to M10");
        });

        it("uses session provider as default when no provider arg is given", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const call = mockApiClient.upgradeSharedTierCluster!.mock.calls[0]![0] as {
                body: { providerSettings: { backingProviderName: string } };
            };
            expect(call.body.providerSettings.backingProviderName).toBe("AWS");
        });

        it("omits backingProviderName when session has no provider and no provider arg", async () => {
            const clusterWithoutProvider: AtlasClusterConnectionInfo = {
                ...connectedFreeCluster,
                provider: undefined,
            };
            tool = buildTool(clusterWithoutProvider);

            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const call = mockApiClient.upgradeSharedTierCluster!.mock.calls[0]![0] as {
                body: { providerSettings: { backingProviderName?: string } };
            };
            expect(call.body.providerSettings.backingProviderName).toBeUndefined();
        });

        it("uses args.projectId and args.clusterName from session when not provided", async () => {
            const result = await exec({});

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith(
                expect.objectContaining({ groupId: "proj1" })
            );
        });
    });

    describe("connected — FLEX cluster", () => {
        const connectedFlexCluster: AtlasClusterConnectionInfo = {
            username: "user",
            projectId: "proj1",
            clusterName: "MyCluster",
            instanceType: "FLEX",
            provider: "AWS",
            region: "US_EAST_1",
            expiryDate: new Date(),
        };

        beforeEach(() => {
            tool = buildTool(connectedFlexCluster);
        });

        it("upgrades FLEX to M10 by default without fetching cluster", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FLEX to M10");

            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
            expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
            const call = mockApiClient.upgradeFlexToDedicated!.mock.calls[0]![0] as {
                groupId: string;
                body: { name: string; clusterType: string };
            };
            expect(call.groupId).toBe("proj1");
            expect(call.body.name).toBe("MyCluster");
            expect(call.body.clusterType).toBe("REPLICASET");
        });

        it("uses session provider and region when no args provided", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const call = mockApiClient.upgradeFlexToDedicated!.mock.calls[0]![0] as {
                body: {
                    replicationSpecs: Array<{ regionConfigs: Array<{ providerName?: string; regionName?: string }> }>;
                };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.providerName).toBe("AWS");
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.regionName).toBe("US_EAST_1");
        });

        it("arg provider and region override session values", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", provider: "GCP", region: "CENTRAL_US" });

            const call = mockApiClient.upgradeFlexToDedicated!.mock.calls[0]![0] as {
                body: {
                    replicationSpecs: Array<{ regionConfigs: Array<{ providerName?: string; regionName?: string }> }>;
                };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.providerName).toBe("GCP");
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.regionName).toBe("CENTRAL_US");
        });
    });

    describe("session resolves projectId and clusterName", () => {
        it("uses session projectId and clusterName when args are omitted", async () => {
            const connectedCluster: AtlasClusterConnectionInfo = {
                username: "user",
                projectId: "session-proj",
                clusterName: "SessionCluster",
                instanceType: "FREE",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            };
            tool = buildTool(connectedCluster);

            const result = await exec({});

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.upgradeSharedTierCluster).toHaveBeenCalledWith(
                expect.objectContaining({ groupId: "session-proj" })
            );
        });

        it("returns error when session cluster exists but projectId/clusterName mismatch args", async () => {
            const connectedCluster: AtlasClusterConnectionInfo = {
                username: "user",
                projectId: "other-proj",
                clusterName: "OtherCluster",
                instanceType: "FREE",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            };
            tool = buildTool(connectedCluster);

            // getCluster will be called because projectId/clusterName don't match session
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.getCluster).toHaveBeenCalledTimes(1);
        });
    });

    describe("structuredContent", () => {
        it("returns originalTier=free and targetTier=flex for FREE to FLEX upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({ originalTier: "FREE", targetTier: "FLEX" });
        });

        it("returns originalTier=FREE and targetTier=M10 for FREE to M10 upgrade", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", targetTier: "M10" });

            expect(result.structuredContent).toMatchObject({ originalTier: "FREE", targetTier: "M10" });
        });

        it("returns originalTier=FLEX and targetTier=M10 for FLEX to M10 upgrade", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).toMatchObject({ originalTier: "FLEX", targetTier: "M10" });
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

        it("does not include cluster IDs in structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            expect(result.structuredContent).not.toHaveProperty("originalClusterId");
            expect(result.structuredContent).not.toHaveProperty("targetClusterId");
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

    describe("telemetry metadata", () => {
        it("resolves originalTier and targetTier from structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: result as never }
            );
            expect(metadata.original_tier).toBe("free");
            expect(metadata.target_tier).toBe("flex");
        });

        it("resolves provider and region from structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                provider: "GCP",
                region: "CENTRAL_US",
            });

            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster", provider: "GCP", region: "CENTRAL_US" } as never,
                { result: result as never }
            );
            expect(metadata.provider).toBe("GCP");
            expect(metadata.region).toBe("CENTRAL_US");
        });

        it("does not include cluster IDs in telemetry metadata", async () => {
            mockApiClient.getCluster!.mockResolvedValue(FREE_CLUSTER_RAW);
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });

            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: result as never }
            );
            expect(metadata).not.toHaveProperty("original_cluster_id");
            expect(metadata).not.toHaveProperty("target_cluster_id");
        });

        it("returns empty metadata fields when result has no structuredContent (error path)", async () => {
            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: { content: [] } as never }
            );
            expect(metadata.original_tier).toBeUndefined();
            expect(metadata.target_tier).toBeUndefined();
        });
    });
});
