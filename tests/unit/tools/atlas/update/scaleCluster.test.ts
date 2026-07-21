import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { ScaleClusterTool } from "../../../../../src/tools/atlas/update/scaleCluster.js";
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

function dedicatedRaw(instanceSize: string, maxInstanceSize?: string): Record<string, unknown> {
    return {
        id: "dedicated-cluster-id",
        replicationSpecs: [
            {
                zoneName: "Zone 1",
                regionConfigs: [
                    {
                        providerName: "AWS",
                        regionName: "US_EAST_1",
                        priority: 7,
                        electableSpecs: { instanceSize, nodeCount: 3 },
                        autoScaling: {
                            compute: {
                                enabled: maxInstanceSize !== undefined,
                                scaleDownEnabled: maxInstanceSize !== undefined,
                                minInstanceSize: maxInstanceSize !== undefined ? instanceSize : undefined,
                                maxInstanceSize,
                            },
                            diskGB: { enabled: true },
                        },
                    },
                ],
            },
        ],
    };
}

const FLEX_CLUSTER_RAW = {
    id: "flex-cluster-id",
    providerSettings: { backingProviderName: "AWS", regionName: "US_EAST_1" },
};

const UPDATE_RESULT = { id: "scaled-cluster-id" };

describe("ScaleClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<Session>;
    let tool: ScaleClusterTool;

    function buildTool(connectedCluster?: AtlasClusterConnectionInfo): ScaleClusterTool {
        mockApiClient = {
            getCluster: vi.fn(),
            getFlexCluster: vi.fn(),
            updateCluster: vi.fn().mockResolvedValue(UPDATE_RESULT),
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
            name: ScaleClusterTool.toolName,
            category: "atlas",
            operationType: ScaleClusterTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new ScaleClusterTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["invoke"](args as never, {} as never);

    function computeFromCall(): {
        enabled: boolean;
        scaleDownEnabled: boolean;
        minInstanceSize?: string;
        maxInstanceSize?: string;
    } {
        const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
            body: {
                replicationSpecs: Array<{
                    regionConfigs: Array<{ autoScaling: { compute: Record<string, unknown> } }>;
                }>;
            };
        };
        return call.body.replicationSpecs[0]!.regionConfigs[0]!.autoScaling.compute as never;
    }

    function electableSizeFromCall(): string {
        const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
            body: {
                replicationSpecs: Array<{ regionConfigs: Array<{ electableSpecs: { instanceSize: string } }> }>;
            };
        };
        return call.body.replicationSpecs[0]!.regionConfigs[0]!.electableSpecs.instanceSize;
    }

    function regionConfigFromCall(): Record<string, unknown> {
        const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
            body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
        };
        return call.body.replicationSpecs[0]!.regionConfigs[0]!;
    }

    beforeEach(() => {
        tool = buildTool();
    });

    describe("argument validation", () => {
        it("errors when projectId and clusterName are missing and not connected", async () => {
            const result = await exec({});
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("projectId and clusterName are required");
        });

        it("errors when no scaling input is provided", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster" });
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("At least one of instanceSize");
            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
        });
    });

    describe("tier redirection", () => {
        it("redirects FLEX clusters (detected via flex endpoint) to atlas-upgrade-cluster", async () => {
            mockApiClient.getCluster!.mockRejectedValue(flexOnRegularApiError());
            mockApiClient.getFlexCluster!.mockResolvedValue(FLEX_CLUSTER_RAW);

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("FLEX cluster");
            expect(text).toContain("atlas-upgrade-cluster");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("redirects connected FREE clusters without any API lookup", async () => {
            tool = buildTool({
                username: "user",
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceType: "FREE",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            });

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("atlas-upgrade-cluster");
            expect(mockApiClient.getCluster).not.toHaveBeenCalled();
        });

        it("surfaces the original error when the cluster is not found on either endpoint", async () => {
            mockApiClient.getCluster!.mockRejectedValue(notFoundError());
            mockApiClient.getFlexCluster!.mockRejectedValue(notFoundError());

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            expect(result.isError).toBe(true);
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });
    });

    describe("unsupported variants", () => {
        it.each(["M40_NVME", "M30_GEN_2", "R40"])("returns a clear error for the %s variant", async (variant) => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw(variant));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("standard M-series");
            expect(text).toContain("high-memory, NVMe, Gen2, and low-CPU");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });
    });

    describe("current tier above the M80 cap", () => {
        it.each(["M100", "M140", "M300"])("rejects scaling a cluster currently at %s", async (size) => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw(size));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("above the M80 cap");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });
    });

    describe("invalid autoscaling bounds", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M30"));
        });

        it("rejects minInstanceSize greater than maxInstanceSize", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                minInstanceSize: "M50",
                maxInstanceSize: "M20",
            });
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("cannot be larger than maxInstanceSize");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("rejects instanceSize above an explicit maxInstanceSize", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceSize: "M60",
                maxInstanceSize: "M40",
            });
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("cannot be larger than maxInstanceSize");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });

        it("rejects instanceSize below an explicit minInstanceSize", async () => {
            const result = await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceSize: "M20",
                minInstanceSize: "M40",
            });
            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("cannot be smaller than minInstanceSize");
            expect(mockApiClient.updateCluster).not.toHaveBeenCalled();
        });
    });

    describe("autoscaling reconciliation", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M30"));
        });

        it("reconciles min to selected size and max two tiers above when only instanceSize is given", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            expect(result.isError).toBeFalsy();
            expect(electableSizeFromCall()).toBe("M30");
            expect(computeFromCall()).toMatchObject({
                enabled: true,
                scaleDownEnabled: true,
                minInstanceSize: "M30",
                maxInstanceSize: "M50",
            });
        });

        it("caps the reconciled max at M80", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M80" });
            expect(computeFromCall().maxInstanceSize).toBe("M80");
        });

        it("preserves an existing higher max", async () => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M80"));
            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M20" });
            expect(computeFromCall().maxInstanceSize).toBe("M80");
        });

        it("preserves an existing max above the M80 cap", async () => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M30", "M100"));
            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M40" });
            expect(computeFromCall().maxInstanceSize).toBe("M100");
        });

        it("does not reconcile when autoscaling inputs are explicit", async () => {
            await exec({
                projectId: "proj1",
                clusterName: "MyCluster",
                instanceSize: "M30",
                minInstanceSize: "M20",
                maxInstanceSize: "M40",
            });
            expect(computeFromCall()).toMatchObject({ minInstanceSize: "M20", maxInstanceSize: "M40" });
        });

        it("disables compute autoscaling when computeAutoScaling is false", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", computeAutoScaling: false });
            expect(computeFromCall()).toMatchObject({ enabled: false, scaleDownEnabled: false });
            expect(electableSizeFromCall()).toBe("M10");
        });

        it("keeps the current size when only autoscaling bounds are provided", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", maxInstanceSize: "M60" });
            expect(electableSizeFromCall()).toBe("M10");
            expect(computeFromCall()).toMatchObject({ enabled: true, minInstanceSize: "M10", maxInstanceSize: "M60" });
        });
    });

    describe("node scaling scope", () => {
        function rawWithAllNodeTypes(): Record<string, unknown> {
            return {
                id: "dedicated-cluster-id",
                replicationSpecs: [
                    {
                        regionConfigs: [
                            {
                                providerName: "AWS",
                                regionName: "US_EAST_1",
                                priority: 7,
                                electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                                readOnlySpecs: { instanceSize: "M10", nodeCount: 2 },
                                analyticsSpecs: { instanceSize: "M10", nodeCount: 1 },
                                autoScaling: {
                                    compute: {
                                        enabled: true,
                                        scaleDownEnabled: true,
                                        minInstanceSize: "M10",
                                        maxInstanceSize: "M30",
                                    },
                                    diskGB: { enabled: true },
                                },
                                analyticsAutoScaling: {
                                    compute: { enabled: false },
                                    diskGB: { enabled: true },
                                },
                            },
                        ],
                    },
                ],
            };
        }

        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(rawWithAllNodeTypes());
        });

        it("scales electable and read-only nodes to the target size", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            const rc = regionConfigFromCall();
            expect((rc.electableSpecs as { instanceSize: string }).instanceSize).toBe("M30");
            expect((rc.readOnlySpecs as { instanceSize: string }).instanceSize).toBe("M30");
        });

        it("does not scale analytics nodes and preserves analyticsAutoScaling", async () => {
            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            const rc = regionConfigFromCall();
            expect((rc.analyticsSpecs as { instanceSize: string }).instanceSize).toBe("M10");
            expect(rc.analyticsAutoScaling).toEqual({ compute: { enabled: false }, diskGB: { enabled: true } });
        });

        it("leaves an analytics-only region untouched", async () => {
            const raw = rawWithAllNodeTypes();
            (raw.replicationSpecs as Array<{ regionConfigs: unknown[] }>)[0]!.regionConfigs.push({
                providerName: "AWS",
                regionName: "US_WEST_2",
                priority: 6,
                analyticsSpecs: { instanceSize: "M10", nodeCount: 1 },
            });
            mockApiClient.getCluster!.mockResolvedValue(raw);

            await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            const call = mockApiClient.updateCluster!.mock.calls[0]![0] as {
                body: { replicationSpecs: Array<{ regionConfigs: Array<Record<string, unknown>> }> };
            };
            const analyticsOnly = call.body.replicationSpecs[0]!.regionConfigs[1]!;
            expect(analyticsOnly.autoScaling).toBeUndefined();
            expect((analyticsOnly.analyticsSpecs as { instanceSize: string }).instanceSize).toBe("M10");
        });
    });

    describe("response and structuredContent", () => {
        beforeEach(() => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M30"));
        });

        it("includes IDLE polling instructions via atlas-inspect-cluster", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("atlas-inspect-cluster");
            expect(text).toContain("IDLE");
        });

        it("returns structuredContent with resolved size, autoscaling and clusterId", async () => {
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            expect(result.structuredContent).toMatchObject({
                clusterName: "MyCluster",
                instanceSize: "M30",
                computeAutoScaling: true,
                minInstanceSize: "M30",
                maxInstanceSize: "M50",
                clusterId: "scaled-cluster-id",
            });
        });

        it("resolves projectId and clusterName from session when omitted", async () => {
            tool = buildTool({
                username: "user",
                projectId: "session-proj",
                clusterName: "SessionCluster",
                instanceType: "DEDICATED",
                provider: "AWS",
                region: "US_EAST_1",
                expiryDate: new Date(),
            });
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M30"));

            const result = await exec({ instanceSize: "M20" });
            expect(result.isError).toBeFalsy();
            expect(mockApiClient.updateCluster).toHaveBeenCalledWith(
                expect.objectContaining({
                    params: { path: { groupId: "session-proj", clusterName: "SessionCluster" } },
                }),
                expect.anything()
            );
        });
    });

    describe("API failure handling", () => {
        it("returns error when updateCluster throws", async () => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M30"));
            mockApiClient.updateCluster!.mockRejectedValue(new Error("scale quota exceeded"));

            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });
            expect(result.isError).toBe(true);
        });
    });

    describe("telemetry metadata", () => {
        it("resolves scaling fields from structuredContent", async () => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedRaw("M10", "M30"));
            const result = await exec({ projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" });

            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster", instanceSize: "M30" } as never,
                { result: result as never }
            );
            expect(metadata.cluster_id).toBe("scaled-cluster-id");
            expect(metadata.instance_size).toBe("M30");
            expect(metadata.compute_auto_scaling).toBe("true");
            expect(metadata.min_instance_size).toBe("M30");
            expect(metadata.max_instance_size).toBe("M50");
        });

        it("returns empty scaling fields when result has no structuredContent (error path)", () => {
            const metadata = tool["resolveTelemetryMetadata"](
                { projectId: "proj1", clusterName: "MyCluster" } as never,
                { result: { content: [] } as never }
            );
            expect(metadata.instance_size).toBeUndefined();
            expect(metadata.compute_auto_scaling).toBeUndefined();
        });
    });
});
