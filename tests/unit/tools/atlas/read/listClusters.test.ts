import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { ListClustersTool } from "../../../../../src/tools/atlas/read/listClusters.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

const projectId = "507f1f77bcf86cd799439011";

const freeClusterApiResponse = {
    name: "free-cluster",
    paused: false,
    stateName: "IDLE",
    mongoDBVersion: "7.0",
    connectionStrings: { standard: "mongodb://host" },
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "TENANT",
                    backingProviderName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M0" },
                },
            ],
        },
    ],
};

const flexClusterApiResponse = {
    name: "flex-cluster",
    stateName: "IDLE",
    mongoDBVersion: "8.0",
    connectionStrings: { standardSrv: "mongodb+srv://flex" },
    providerSettings: {
        backingProviderName: "AWS",
        regionName: "US_EAST_1",
    },
};

describe("ListClustersTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: ListClustersTool;

    beforeEach(() => {
        mockApiClient = {
            getGroup: vi.fn(),
            listClusters: vi.fn(),
            listFlexClusters: vi.fn(),
            listClusterDetails: vi.fn(),
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

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: ListClustersTool.toolName,
            category: "atlas",
            operationType: ListClustersTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new ListClustersTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = { projectId }) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    describe("with projectId", () => {
        beforeEach(() => {
            mockApiClient.getGroup!.mockResolvedValue({ id: projectId, name: "My Project" });
        });

        it("returns formatted clusters when traditional and flex clusters exist", async () => {
            mockApiClient.listClusters!.mockResolvedValue({ results: [freeClusterApiResponse] });
            mockApiClient.listFlexClusters!.mockResolvedValue({ results: [flexClusterApiResponse] });

            const result = await exec();

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain('Found 2 clusters in project "My Project"');
            expect(text).toContain(projectId);
            expect(text).toContain("<untrusted-user-data-");
        });

        it("calls getGroup, listClusters, and listFlexClusters", async () => {
            mockApiClient.listClusters!.mockResolvedValue({ results: [] });
            mockApiClient.listFlexClusters!.mockResolvedValue({ results: [] });

            await exec();

            expect(mockApiClient.getGroup).toHaveBeenCalledWith(
                { params: { path: { groupId: projectId } } },
                expect.anything()
            );
            expect(mockApiClient.listClusters).toHaveBeenCalledWith(
                { params: { path: { groupId: projectId } } },
                expect.anything()
            );
            expect(mockApiClient.listFlexClusters).toHaveBeenCalledWith(
                { params: { path: { groupId: projectId } } },
                expect.anything()
            );
        });

        it("returns empty message when no clusters exist", async () => {
            mockApiClient.listClusters!.mockResolvedValue({ results: [] });
            mockApiClient.listFlexClusters!.mockResolvedValue({ results: [] });

            const result = await exec();

            expect((result.content[0] as { text: string }).text).toBe("No clusters found.");
        });

        it("tolerates listFlexClusters failure", async () => {
            mockApiClient.listClusters!.mockResolvedValue({ results: [freeClusterApiResponse] });
            mockApiClient.listFlexClusters!.mockRejectedValue(new Error("flex unavailable"));

            const result = await exec();

            expect(result.structuredContent).toMatchObject({
                projectId,
                totalCount: 1,
                clusters: [expect.objectContaining({ name: "free-cluster", instanceType: "FREE" })],
            });
        });

        it("tolerates listClusters failure", async () => {
            mockApiClient.listClusters!.mockRejectedValue(new Error("clusters unavailable"));
            mockApiClient.listFlexClusters!.mockResolvedValue({ results: [flexClusterApiResponse] });

            const result = await exec();

            expect(result.structuredContent).toMatchObject({
                projectId,
                totalCount: 1,
                clusters: [expect.objectContaining({ name: "flex-cluster", instanceType: "FLEX" })],
            });
        });

        it("throws when project is not found", async () => {
            mockApiClient.getGroup!.mockResolvedValue({});

            await expect(exec()).rejects.toThrow(`Project with ID "${projectId}" not found.`);
        });

        describe("structuredContent", () => {
            it("returns project clusters and totalCount on success", async () => {
                mockApiClient.listClusters!.mockResolvedValue({ results: [freeClusterApiResponse] });
                mockApiClient.listFlexClusters!.mockResolvedValue({ results: [] });

                const result = await exec();

                expect(result.structuredContent).toEqual({
                    projectId,
                    clusters: [
                        {
                            name: "free-cluster",
                            instanceType: "FREE",
                            instanceSize: undefined,
                            provider: "AWS",
                            region: "US_EAST_1",
                            paused: false,
                            state: "IDLE",
                            mongoDBVersion: "7.0",
                            connectionStrings: { standard: "mongodb://host" },
                            processIds: ["host"],
                        },
                    ],
                    totalCount: 1,
                });
            });

            it("returns empty clusters when project has no clusters", async () => {
                mockApiClient.listClusters!.mockResolvedValue({ results: [] });
                mockApiClient.listFlexClusters!.mockResolvedValue({ results: [] });

                const result = await exec();

                expect(result.structuredContent).toEqual({
                    projectId,
                    clusters: [],
                    totalCount: 0,
                });
            });
        });
    });

    describe("without projectId", () => {
        it("returns cluster summaries across all projects", async () => {
            mockApiClient.listClusterDetails!.mockResolvedValue({
                results: [
                    {
                        groupId: "proj-a",
                        groupName: "Project A",
                        clusters: [{ name: "cluster-a" }],
                    },
                ],
            });

            const result = await exec({});

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found 1 clusters across all projects");
            expect(mockApiClient.listClusterDetails).toHaveBeenCalledWith(undefined, expect.anything());
            expect(mockApiClient.getGroup).not.toHaveBeenCalled();
        });

        it("returns empty message when no clusters exist across projects", async () => {
            mockApiClient.listClusterDetails!.mockResolvedValue({ results: [] });

            const result = await exec({});

            expect((result.content[0] as { text: string }).text).toBe("No clusters found.");
        });

        it("returns empty message when projects exist but contain no clusters", async () => {
            mockApiClient.listClusterDetails!.mockResolvedValue({
                results: [{ groupId: "proj-a", groupName: "Project A", clusters: [] }],
            });

            const result = await exec({});

            expect((result.content[0] as { text: string }).text).toBe("No clusters found.");
        });

        describe("structuredContent", () => {
            it("returns cluster summaries and totalCount", async () => {
                mockApiClient.listClusterDetails!.mockResolvedValue({
                    results: [
                        {
                            groupId: "proj-a",
                            groupName: "Project A",
                            clusters: [{ name: "cluster-a" }, { name: "cluster-b" }],
                        },
                        {
                            groupId: "proj-b",
                            groupName: "Project B",
                            clusters: [{ name: "cluster-c" }],
                        },
                    ],
                });

                const result = await exec({});

                expect(result.structuredContent).toEqual({
                    clusters: [
                        { projectName: "Project A", projectId: "proj-a", clusterName: "cluster-a" },
                        { projectName: "Project A", projectId: "proj-a", clusterName: "cluster-b" },
                        { projectName: "Project B", projectId: "proj-b", clusterName: "cluster-c" },
                    ],
                    totalCount: 3,
                });
            });

            it("returns empty clusters when no results", async () => {
                mockApiClient.listClusterDetails!.mockResolvedValue({ results: [] });

                const result = await exec({});

                expect(result.structuredContent).toEqual({
                    clusters: [],
                    totalCount: 0,
                });
            });

            it("omits structuredContent on error paths", async () => {
                mockApiClient.listClusterDetails!.mockRejectedValue(new Error("API failure"));

                await expect(exec({})).rejects.toThrow("API failure");
            });
        });
    });
});
