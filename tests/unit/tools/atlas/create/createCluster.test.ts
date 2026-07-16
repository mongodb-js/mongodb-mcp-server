import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateClusterTool, CreateClusterArgsShape } from "../../../../../src/tools/atlas/create/createCluster.js";
import { z } from "zod";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import type { Keychain } from "../../../../../src/lib.js";
import { ApiClientError } from "../../../../../src/common/atlas/apiClientError.js";

const BASE_ARGS = {
    projectId: "507f1f77bcf86cd799439011",
    clusterName: "my-cluster",
    provider: "AWS" as const,
    region: "US_EAST_1",
};

const CREATE_RESULT = { id: "new-cluster-id" };

describe("CreateClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<Session>;
    let tool: CreateClusterTool;

    function buildTool(): CreateClusterTool {
        mockApiClient = {
            listClusters: vi.fn().mockResolvedValue({ results: [] }),
            createCluster: vi.fn().mockResolvedValue(CREATE_RESULT),
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" }),
            createAccessListEntry: vi.fn().mockResolvedValue({}),
        };
        Object.assign(mockApiClient, { supportsCurrentIpLookup: true });

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;
        Object.assign(mockApiClient, { logger: mockLogger });

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
            name: CreateClusterTool.toolName,
            category: "atlas",
            operationType: CreateClusterTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new CreateClusterTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(CreateClusterArgsShape).parse(args) as never, {} as never);

    beforeEach(() => {
        tool = buildTool();
    });

    describe("request body", () => {
        it("sends correct defaults when only required params are provided", async () => {
            const result = await exec(BASE_ARGS);

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "507f1f77bcf86cd799439011" } },
                    body: {
                        name: "my-cluster",
                        clusterType: "REPLICASET",
                        backupEnabled: true,
                        pitEnabled: false,
                        terminationProtectionEnabled: false,
                        versionReleaseSystem: "CONTINUOUS",
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

        it("sends correct body when all params are provided", async () => {
            const result = await exec({
                ...BASE_ARGS,
                clusterType: "SHARDED",
                instanceSize: "M40",
                computeAutoScaling: false,
                diskSizeGB: 100,
                mongoDBVersion: "8.0",
                backup: "CONTINUOUS",
                terminationProtectionEnabled: true,
            });

            expect(result.isError).toBeFalsy();
            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "507f1f77bcf86cd799439011" } },
                    body: {
                        name: "my-cluster",
                        clusterType: "SHARDED",
                        backupEnabled: true,
                        pitEnabled: true,
                        terminationProtectionEnabled: true,
                        versionReleaseSystem: "LTS",
                        mongoDBMajorVersion: "8.0",
                        replicationSpecs: [
                            {
                                regionConfigs: [
                                    {
                                        providerName: "AWS",
                                        regionName: "US_EAST_1",
                                        priority: 7,
                                        electableSpecs: { instanceSize: "M40", nodeCount: 3, diskSizeGB: 100 },
                                        autoScaling: {
                                            compute: { enabled: false, scaleDownEnabled: false },
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
    });

    describe("instance size defaulting", () => {
        it.each([
            ["M10", 0],
            ["M10", 1],
            ["M30", 2],
        ] as const)("defaults to %s when project has %i existing clusters", async (expected, count) => {
            mockApiClient.listClusters!.mockResolvedValue({ results: Array(count).fill({}) });

            const result = await exec(BASE_ARGS);

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({ instanceSize: expected });
        });

        it("uses provided instanceSize without calling listClusters", async () => {
            const result = await exec({ ...BASE_ARGS, instanceSize: "M50" });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({ instanceSize: "M50" });
            expect(mockApiClient.listClusters).not.toHaveBeenCalled();
        });

        it("defaults to M30 for SHARDED without calling listClusters", async () => {
            const result = await exec({ ...BASE_ARGS, clusterType: "SHARDED" });

            expect(result.isError).toBeFalsy();
            expect(result.structuredContent).toMatchObject({ instanceSize: "M30", clusterType: "SHARDED" });
            expect(mockApiClient.listClusters).not.toHaveBeenCalled();
        });
    });

    describe("compute autoscaling min/max instance size", () => {
        it.each([
            ["AWS", "M10", "M30"],
            ["AWS", "M20", "M40"],
            ["AWS", "M30", "M50"],
            ["AWS", "M40", "M60"],
            ["AWS", "M50", "M80"],
            ["AWS", "M60", "M140"],
            ["AWS", "M80", "M200"],
            ["GCP", "M60", "M140"],
            ["GCP", "M80", "M200"],
            ["AZURE", "M60", "M200"],
            ["AZURE", "M80", "M200"],
        ] as const)("provider=%s, instanceSize=%s → max=%s", async (provider, instanceSize, expectedMax) => {
            await exec({ ...BASE_ARGS, provider, instanceSize });

            const call = mockApiClient.createCluster!.mock.calls[0]![0] as {
                body: {
                    replicationSpecs: Array<{
                        regionConfigs: Array<{
                            autoScaling: { compute: { minInstanceSize: string; maxInstanceSize: string } };
                        }>;
                    }>;
                };
            };
            expect(call.body.replicationSpecs[0]!.regionConfigs[0]!.autoScaling.compute).toMatchObject({
                minInstanceSize: instanceSize,
                maxInstanceSize: expectedMax,
            });
        });

        it("disables compute autoscaling when computeAutoScaling is false", async () => {
            await exec({ ...BASE_ARGS, instanceSize: "M10", computeAutoScaling: false });

            expect(mockApiClient.createCluster).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: "507f1f77bcf86cd799439011" } },
                    body: {
                        name: "my-cluster",
                        clusterType: "REPLICASET",
                        backupEnabled: true,
                        pitEnabled: false,
                        terminationProtectionEnabled: false,
                        versionReleaseSystem: "CONTINUOUS",
                        replicationSpecs: [
                            {
                                regionConfigs: [
                                    {
                                        providerName: "AWS",
                                        regionName: "US_EAST_1",
                                        priority: 7,
                                        electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                                        autoScaling: {
                                            compute: { enabled: false, scaleDownEnabled: false },
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
    });

    describe("response", () => {
        it("returns expected text content and structuredContent", async () => {
            const result = await exec({ ...BASE_ARGS, instanceSize: "M10" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("my-cluster");
            expect(text).toContain("507f1f77bcf86cd799439011");
            expect(text).toContain("atlas-inspect-cluster");
            expect(result.structuredContent).toMatchObject({
                clusterId: "new-cluster-id",
                provider: "AWS",
                region: "US_EAST_1",
                instanceSize: "M10",
                clusterType: "REPLICASET",
                mongoDBVersion: "LATEST",
                backup: "SNAPSHOT",
                computeAutoScaling: true,
                terminationProtectionEnabled: false,
            });
        });
    });

    describe("IP access list", () => {
        it("adds the current IP to the access list and discloses it", async () => {
            const result = await exec(BASE_ARGS);

            expect(mockApiClient.createAccessListEntry).toHaveBeenCalledOnce();
            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Your current IP address has been added");
        });

        it("does not mention the access list when the current IP is already present", async () => {
            mockApiClient.createAccessListEntry?.mockRejectedValue(
                ApiClientError.fromError(
                    { status: 409, statusText: "Conflict" } as Response,
                    { message: "Conflict" } as never
                )
            );

            const result = await exec(BASE_ARGS);

            expect(result.isError).toBeFalsy();
            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).not.toContain("access list");
        });

        it("still creates the cluster and notes that no access list changes were made when the IP lookup fails", async () => {
            mockApiClient.getIpInfo?.mockRejectedValue(new Error("ipinfo unavailable"));

            const result = await exec(BASE_ARGS);

            expect(mockApiClient.createCluster).toHaveBeenCalledOnce();
            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("No IP access list changes were made");
            expect(text).toContain("did not succeed");
        });
    });

    describe("telemetry metadata", () => {
        it("resolves all fields from structuredContent", async () => {
            const args = { ...BASE_ARGS, instanceSize: "M30", diskSizeGB: 20 };
            const result = await exec(args);

            const metadata = tool["resolveTelemetryMetadata"](args as never, { result: result as never });
            expect(metadata.cluster_id).toBe("new-cluster-id");
            expect(metadata.provider).toBe("AWS");
            expect(metadata.region).toBe("US_EAST_1");
            expect(metadata.instance_size).toBe("M30");
            expect(metadata.cluster_type).toBe("REPLICASET");
            expect(metadata.backup).toBe("SNAPSHOT");
            expect(metadata.compute_auto_scaling).toBe("true");
            expect(metadata.termination_protection).toBe("false");
            expect(metadata.disk_size_gb).toBe(20);
            expect(metadata.mongodb_version).toBe("LATEST");
        });

        it("returns empty metadata fields when result has no structuredContent (error path)", () => {
            const metadata = tool["resolveTelemetryMetadata"](BASE_ARGS as never, {
                result: { content: [] } as never,
            });

            expect(metadata.cluster_id).toBeUndefined();
            expect(metadata.provider).toBeUndefined();
            expect(metadata.region).toBeUndefined();
            expect(metadata.instance_size).toBeUndefined();
            expect(metadata.cluster_type).toBeUndefined();
            expect(metadata.backup).toBeUndefined();
            expect(metadata.compute_auto_scaling).toBeUndefined();
            expect(metadata.termination_protection).toBeUndefined();
            expect(metadata.disk_size_gb).toBeUndefined();
            expect(metadata.mongodb_version).toBeUndefined();
        });
    });

    describe("error cases", () => {
        it.each(["M10", "M20"] as const)(
            "returns error for SHARDED with instance size %s (requires M30+)",
            async (instanceSize) => {
                const result = await exec({ ...BASE_ARGS, clusterType: "SHARDED", instanceSize });

                expect(result.isError).toBe(true);
                expect((result.content[0] as { text: string }).text).toContain(
                    "SHARDED clusters require M30 or higher"
                );
            }
        );

        it("returns error when createCluster API call fails", async () => {
            mockApiClient.createCluster!.mockRejectedValue(new Error("network error"));

            const result = await exec({ ...BASE_ARGS, instanceSize: "M30" });

            expect(result.isError).toBe(true);
        });

        it("returns error when listClusters API call fails", async () => {
            mockApiClient.listClusters!.mockRejectedValue(new Error("network error"));

            const result = await exec(BASE_ARGS);

            expect(result.isError).toBe(true);
        });
    });
});
