import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsDiscoverTool } from "../../../../../src/tools/atlas/streams/discover.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
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
    // Helper to call execute with partial args (tests validate missing fields at runtime)
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    describe("list-workspaces", () => {
        it("should return workspace list when workspaces exist", async () => {
            mockApiClient.listStreamWorkspaces!.mockResolvedValue({
                results: [
                    {
                        name: "ws1",
                        dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                        streamConfig: { tier: "SP10", maxTierSize: "SP50" },
                    },
                ],
                totalCount: 1,
            });

            const result = await exec({ ...baseArgs, action: "list-workspaces" });

            expect(result.content).toBeDefined();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("1 workspace(s)");
        });

        it("should return empty message when no workspaces", async () => {
            mockApiClient.listStreamWorkspaces!.mockResolvedValue({ results: [] });

            const result = await exec({ ...baseArgs, action: "list-workspaces" });

            expect((result.content[0] as { text: string }).text).toContain("No Stream Processing workspaces");
        });

        it("should pass limit and pageNum to API", async () => {
            mockApiClient.listStreamWorkspaces!.mockResolvedValue({ results: [], totalCount: 0 });

            await exec({ ...baseArgs, action: "list-workspaces", limit: 5, pageNum: 2 });

            expect(mockApiClient.listStreamWorkspaces).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1" }, query: { itemsPerPage: 5, pageNum: 2 } },
            });
        });
    });

    describe("inspect-workspace", () => {
        it("should throw when workspaceName is not provided", async () => {
            await expect(exec({ ...baseArgs, action: "inspect-workspace" })).rejects.toThrow(
                "workspaceName is required"
            );
        });

        it("should return workspace details", async () => {
            mockApiClient.getStreamWorkspace!.mockResolvedValue({
                name: "ws1",
                dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                streamConfig: { tier: "SP10" },
                connections: [{ name: "c1" }],
            });

            const result = await exec({
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
            mockApiClient.getStreamProcessor!.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                stats: { inputMessageCount: 100, outputMessageCount: 90, dlqMessageCount: 10 },
                pipeline: [{ $source: { connectionName: "kafka-in" } }],
                options: { dlq: { connectionName: "cluster", db: "mydb", coll: "dlq" } },
            });
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [
                    { name: "kafka-in", type: "Kafka", state: "ACTIVE" },
                    { name: "cluster", type: "Cluster", state: "ACTIVE" },
                ],
            });

            const result = await exec({
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
                exec({
                    ...baseArgs,
                    action: "diagnose-processor",
                    workspaceName: "ws1",
                })
            ).rejects.toThrow("resourceName is required");
        });

        it("should show DLQ warning when all messages go to DLQ", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                stats: { inputMessageCount: 100, outputMessageCount: 0, dlqMessageCount: 100 },
                pipeline: [{ $source: { connectionName: "src" } }],
            });
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "diagnose-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("All 100 input messages went to DLQ");
            expect(text).toContain("Health Warning");
        });

        it("should show high-DLQ-ratio warning when over 50% fail", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                stats: { inputMessageCount: 100, outputMessageCount: 30, dlqMessageCount: 70 },
                pipeline: [{ $source: { connectionName: "src" } }],
            });
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "diagnose-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("70% of messages going to DLQ");
            expect(text).toContain("Health Warning");
        });

        it("should skip health analysis when stats are empty", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                stats: {},
                pipeline: [{ $source: { connectionName: "src" } }],
            });
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "diagnose-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Processor State");
            expect(text).not.toContain("Processor Stats");
        });

        it("should handle processor fetch failure gracefully", async () => {
            mockApiClient.getStreamProcessor!.mockRejectedValue(new Error("API timeout"));
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "diagnose-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Error fetching processor");
        });
    });

    describe("list-connections", () => {
        it("should return connection list when connections exist", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({
                results: [
                    { name: "kafka-in", type: "Kafka", state: "ACTIVE" },
                    { name: "cluster-out", type: "Cluster", state: "ACTIVE" },
                ],
            });

            const result = await exec({
                ...baseArgs,
                action: "list-connections",
                workspaceName: "ws1",
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("2 connection(s)");
        });

        it("should return empty message when no connections", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "list-connections",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("No connections found");
        });

        it("should pass limit and pageNum to API", async () => {
            mockApiClient.listStreamConnections!.mockResolvedValue({ results: [] });

            await exec({
                ...baseArgs,
                action: "list-connections",
                workspaceName: "ws1",
                limit: 10,
                pageNum: 3,
            });

            expect(mockApiClient.listStreamConnections).toHaveBeenCalledWith({
                params: {
                    path: { groupId: "proj1", tenantName: "ws1" },
                    query: { itemsPerPage: 10, pageNum: 3 },
                },
            });
        });

        it("should throw when workspaceName is missing", async () => {
            await expect(exec({ ...baseArgs, action: "list-connections" })).rejects.toThrow(
                "workspaceName is required"
            );
        });
    });

    describe("inspect-connection", () => {
        it("should return connection details", async () => {
            mockApiClient.getStreamConnection!.mockResolvedValue({
                name: "kafka-in",
                type: "Kafka",
                bootstrapServers: "broker:9092",
            });

            const result = await exec({
                ...baseArgs,
                action: "inspect-connection",
                workspaceName: "ws1",
                resourceName: "kafka-in",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("kafka-in");
            expect(text).toContain("ws1");
        });

        it("should add note when Cluster connection name differs from clusterName", async () => {
            mockApiClient.getStreamConnection!.mockResolvedValue({
                name: "my-conn",
                type: "Cluster",
                clusterName: "actual-cluster",
            });

            const result = await exec({
                ...baseArgs,
                action: "inspect-connection",
                workspaceName: "ws1",
                resourceName: "my-conn",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Note");
            expect(text).toContain("my-conn");
            expect(text).toContain("actual-cluster");
        });

        it("should throw when resourceName is missing", async () => {
            await expect(exec({ ...baseArgs, action: "inspect-connection", workspaceName: "ws1" })).rejects.toThrow(
                "resourceName is required"
            );
        });
    });

    describe("list-processors", () => {
        it("should return processor list when processors exist", async () => {
            mockApiClient.getStreamProcessors!.mockResolvedValue({
                results: [
                    { name: "proc1", state: "STARTED", tier: "SP10" },
                    { name: "proc2", state: "STOPPED", tier: "SP30" },
                ],
            });

            const result = await exec({
                ...baseArgs,
                action: "list-processors",
                workspaceName: "ws1",
            });

            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("2 processor(s)");
        });

        it("should return empty message when no processors", async () => {
            mockApiClient.getStreamProcessors!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "list-processors",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("No processors found");
        });

        it("should throw when workspaceName is missing", async () => {
            await expect(exec({ ...baseArgs, action: "list-processors" })).rejects.toThrow("workspaceName is required");
        });
    });

    describe("inspect-processor", () => {
        it("should return processor details", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({
                name: "proc1",
                state: "STARTED",
                tier: "SP10",
                pipeline: [{ $source: { connectionName: "kafka-in" } }],
            });

            const result = await exec({
                ...baseArgs,
                action: "inspect-processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("proc1");
            expect(text).toContain("ws1");
        });

        it("should throw when resourceName is missing", async () => {
            await expect(exec({ ...baseArgs, action: "inspect-processor", workspaceName: "ws1" })).rejects.toThrow(
                "resourceName is required"
            );
        });
    });

    describe("get-logs", () => {
        it("should decompress and return operational logs", async () => {
            const { gzipSync } = await import("node:zlib");
            const logData = "2024-01-01 log line 1\n2024-01-01 log line 2\n";
            const compressed = gzipSync(Buffer.from(logData));
            const arrayBuffer = compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            );
            mockApiClient.downloadOperationalLogs!.mockResolvedValue(arrayBuffer);

            const result = await exec({
                ...baseArgs,
                action: "get-logs",
                workspaceName: "ws1",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Operational logs");
            expect(text).toContain("log line 1");
        });

        it("should use audit log API when logType is audit", async () => {
            const { gzipSync } = await import("node:zlib");
            const logData = "audit entry\n";
            const compressed = gzipSync(Buffer.from(logData));
            const arrayBuffer = compressed.buffer.slice(
                compressed.byteOffset,
                compressed.byteOffset + compressed.byteLength
            );
            mockApiClient.downloadAuditLogs!.mockResolvedValue(arrayBuffer);

            const result = await exec({
                ...baseArgs,
                action: "get-logs",
                workspaceName: "ws1",
                logType: "audit",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Audit logs");
            expect(mockApiClient.downloadAuditLogs).toHaveBeenCalledOnce();
        });

        it("should return no-data message when API returns null", async () => {
            mockApiClient.downloadOperationalLogs!.mockResolvedValue(null);

            const result = await exec({
                ...baseArgs,
                action: "get-logs",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("No logs available");
        });

        it("should return fallback message when decompression fails", async () => {
            mockApiClient.downloadOperationalLogs!.mockResolvedValue(new ArrayBuffer(10));

            const result = await exec({
                ...baseArgs,
                action: "get-logs",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("Could not decompress");
        });
    });

    describe("get-networking", () => {
        it("should return PrivateLink details", async () => {
            mockApiClient.listPrivateLinkConnections!.mockResolvedValue({
                results: [{ _id: "pl-1", provider: "AWS", region: "us-east-1", state: "AVAILABLE", vendor: "AWS" }],
            });

            const result = await exec({
                ...baseArgs,
                action: "get-networking",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("PrivateLink");
            expect(text).toContain("pl-1");
        });

        it("should include account details when cloudProvider and region are provided", async () => {
            mockApiClient.listPrivateLinkConnections!.mockResolvedValue({ results: [] });
            mockApiClient.getAccountDetails!.mockResolvedValue({ awsAccountId: "123456789" });

            const result = await exec({
                ...baseArgs,
                action: "get-networking",
                cloudProvider: "AWS",
                region: "VIRGINIA_USA",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("Account Details");
            expect(text).toContain("123456789");
        });

        it("should handle empty networking results", async () => {
            mockApiClient.listPrivateLinkConnections!.mockResolvedValue({ results: [] });

            const result = await exec({
                ...baseArgs,
                action: "get-networking",
            });

            const text = result.content.map((c) => (c as { text: string }).text).join("\n");
            expect(text).toContain("No PrivateLink connections found");
        });
    });

    describe("unknown action", () => {
        it("should return error for unknown action", async () => {
            const result = await exec({
                ...baseArgs,
                action: "nonexistent" as never,
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Unknown action");
        });
    });
});
