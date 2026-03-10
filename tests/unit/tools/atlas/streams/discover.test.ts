import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsDiscoverTool } from "../../../../../src/tools/atlas/streams/discover.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logger.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";

describe("StreamsDiscoverTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: StreamsDiscoverTool;

    beforeEach(() => {
        mockApiClient = {
            listStreamWorkspaces: vi.fn(),
            getStreamWorkspace: vi.fn(),
            listStreamConnections: vi.fn(),
            getStreamConnection: vi.fn(),
            getStreamProcessors: vi.fn(),
            getStreamProcessor: vi.fn(),
            downloadOperationalLogs: vi.fn(),
            downloadAuditLogs: vi.fn(),
            listPrivateLinkConnections: vi.fn(),
            listActivePeeringConnections: vi.fn(),
            getAccountDetails: vi.fn(),
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
            previewFeatures: ["streams"],
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
            name: StreamsDiscoverTool.toolName,
            category: "atlas",
            operationType: StreamsDiscoverTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsDiscoverTool(params);
    });

    const baseArgs = { projectId: "proj1" };

    describe("list-workspaces", () => {
        it("should return workspace list when workspaces exist", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({
                results: [
                    {
                        name: "ws1",
                        dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                        streamConfig: { tier: "SP10", maxTierSize: "SP50" },
                    },
                ],
                totalCount: 1,
            });

            const result = await tool["execute"]({ ...baseArgs, action: "list-workspaces" });

            expect(result.content).toBeDefined();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("1 workspace(s)");
        });

        it("should return empty message when no workspaces", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({ results: [] });

            const result = await tool["execute"]({ ...baseArgs, action: "list-workspaces" });

            expect((result.content[0] as { text: string }).text).toContain("No Stream Processing workspaces");
        });

        it("should pass limit and pageNum to API", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({ results: [], totalCount: 0 });

            await tool["execute"]({ ...baseArgs, action: "list-workspaces", limit: 5, pageNum: 2 });

            expect(mockApiClient.listStreamWorkspaces).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" }, query: { itemsPerPage: 5, pageNum: 2 } },
            });
        });
    });

    describe("inspect-workspace", () => {
        it("should throw when workspaceName is not provided", async () => {
            await expect(
                tool["execute"]({ ...baseArgs, action: "inspect-workspace" })
            ).rejects.toThrow("workspaceName is required");
        });

        it("should return workspace details", async () => {
            mockApiClient.getStreamWorkspace.mockResolvedValue({
                name: "ws1",
                dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                streamConfig: { tier: "SP10" },
                connections: [{ name: "c1" }],
            });

            const result = await tool["execute"]({
                ...baseArgs,
                action: "inspect-workspace",
                workspaceName: "ws1",
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("ws1");
        });
    });

    describe("diagnose-processor", () => {
        it("should combine processor state, stats, and connection health in report", async () => {
            mockApiClient.getStreamProcessor.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                stats: { inputMessageCount: 100, outputMessageCount: 90, dlqMessageCount: 10 },
                pipeline: [{ $source: { connectionName: "kafka-in" } }],
                options: { dlq: { connectionName: "cluster", db: "mydb", coll: "dlq" } },
            });
            mockApiClient.listStreamConnections.mockResolvedValue({
                results: [
                    { name: "kafka-in", type: "Kafka", state: "ACTIVE" },
                    { name: "cluster", type: "Cluster", state: "ACTIVE" },
                ],
            });

            const result = await tool["execute"]({
                ...baseArgs,
                action: "diagnose-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Processor State");
            expect(text).toContain("proc1");
            expect(text).toContain("STARTED");
            expect(text).toContain("Connection Health");
            expect(text).toContain("Dead Letter Queue");
        });

        it("should throw when resourceName is not provided", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    action: "diagnose-processor",
                    workspaceName: "ws1",
                })
            ).rejects.toThrow("resourceName is required");
        });
    });

    describe("find-processor", () => {
        it("should search across all workspaces and find processor", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({
                results: [{ name: "ws1" }, { name: "ws2" }],
            });
            // First workspace: 404 (not found)
            mockApiClient.getStreamProcessor
                .mockRejectedValueOnce(new Error("Not found"))
                .mockResolvedValueOnce({
                    name: "target-proc",
                    state: "STARTED",
                    tier: "SP10",
                });

            const result = await tool["execute"]({
                ...baseArgs,
                action: "find-processor",
                resourceName: "target-proc",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Found processor");
            expect(text).toContain("target-proc");
            expect(text).toContain("ws2");
        });

        it("should return not-found message when processor doesn't exist in any workspace", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({
                results: [{ name: "ws1" }],
            });
            mockApiClient.getStreamProcessor.mockRejectedValue(new Error("Not found"));

            const result = await tool["execute"]({
                ...baseArgs,
                action: "find-processor",
                resourceName: "missing-proc",
            });

            expect((result.content[0] as { text: string }).text).toContain("not found");
        });
    });

    describe("list-all-processors", () => {
        it("should aggregate processors from multiple workspaces", async () => {
            mockApiClient.listStreamWorkspaces.mockResolvedValue({
                results: [{ name: "ws1" }, { name: "ws2" }],
            });
            mockApiClient.getStreamProcessors
                .mockResolvedValueOnce({
                    results: [{ name: "p1", state: "STARTED", tier: "SP10" }],
                })
                .mockResolvedValueOnce({
                    results: [{ name: "p2", state: "STOPPED", tier: "SP5" }],
                });

            const result = await tool["execute"]({
                ...baseArgs,
                action: "list-all-processors",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("2 processor(s)");
            expect(text).toContain("2 workspace(s)");
        });
    });

    describe("unknown action", () => {
        it("should return error for unknown action", async () => {
            const result = await tool["execute"]({
                ...baseArgs,
                action: "nonexistent" as never,
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Unknown action");
        });
    });
});
