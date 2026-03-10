import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsTeardownTool } from "../../../../../src/tools/atlas/streams/teardown.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logger.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";

describe("StreamsTeardownTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: StreamsTeardownTool;

    beforeEach(() => {
        mockApiClient = {
            getStreamProcessor: vi.fn(),
            stopStreamProcessor: vi.fn(),
            deleteStreamProcessor: vi.fn(),
            getStreamProcessors: vi.fn(),
            deleteStreamConnection: vi.fn(),
            listStreamConnections: vi.fn(),
            deleteStreamWorkspace: vi.fn(),
            deletePrivateLinkConnection: vi.fn(),
            deleteVpcPeeringConnection: vi.fn(),
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
            requestConfirmation: vi.fn().mockResolvedValue(true),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: StreamsTeardownTool.toolName,
            category: "atlas",
            operationType: StreamsTeardownTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsTeardownTool(params);
    });

    const baseArgs = { projectId: "proj1" };

    describe("deleteProcessor", () => {
        it("should stop then delete a STARTED processor", async () => {
            mockApiClient.getStreamProcessor.mockResolvedValue({ state: "STARTED", name: "proc1" });
            mockApiClient.stopStreamProcessor.mockResolvedValue({});
            mockApiClient.deleteStreamProcessor.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            expect(mockApiClient.stopStreamProcessor).toHaveBeenCalledOnce();
            expect(mockApiClient.deleteStreamProcessor).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("deleted");
        });

        it("should delete a STOPPED processor without stopping first", async () => {
            mockApiClient.getStreamProcessor.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            mockApiClient.deleteStreamProcessor.mockResolvedValue({});

            await tool["execute"]({
                ...baseArgs,
                resource: "processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });

            expect(mockApiClient.stopStreamProcessor).not.toHaveBeenCalled();
            expect(mockApiClient.deleteStreamProcessor).toHaveBeenCalledOnce();
        });

        it("should throw when workspaceName is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "processor",
                    resourceName: "proc1",
                })
            ).rejects.toThrow("workspaceName is required");
        });

        it("should throw when resourceName is missing", async () => {
            await expect(
                tool["execute"]({
                    ...baseArgs,
                    resource: "processor",
                    workspaceName: "ws1",
                })
            ).rejects.toThrow("resourceName is required");
        });
    });

    describe("deleteConnection", () => {
        it("should delete connection when no processors reference it", async () => {
            mockApiClient.getStreamProcessors.mockResolvedValue({ results: [] });
            mockApiClient.deleteStreamConnection.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                workspaceName: "ws1",
                resourceName: "conn1",
            });

            expect(mockApiClient.deleteStreamConnection).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });

        it("should warn and NOT delete when running processor references connection", async () => {
            mockApiClient.getStreamProcessors.mockResolvedValue({
                results: [
                    {
                        name: "proc1",
                        state: "STARTED",
                        pipeline: [{ $source: { connectionName: "conn1" } }],
                    },
                ],
            });

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                workspaceName: "ws1",
                resourceName: "conn1",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Warning");
            expect((result.content[0] as { text: string }).text).toContain("running processor");
            expect(mockApiClient.deleteStreamConnection).not.toHaveBeenCalled();
        });

        it("should proceed with deletion when only stopped processors reference connection", async () => {
            mockApiClient.getStreamProcessors.mockResolvedValue({
                results: [
                    {
                        name: "proc1",
                        state: "STOPPED",
                        pipeline: [{ $source: { connectionName: "conn1" } }],
                    },
                ],
            });
            mockApiClient.deleteStreamConnection.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                workspaceName: "ws1",
                resourceName: "conn1",
            });

            expect(mockApiClient.deleteStreamConnection).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });

        it("should proceed with deletion when processor list API fails", async () => {
            mockApiClient.getStreamProcessors.mockRejectedValue(new Error("API error"));
            mockApiClient.deleteStreamConnection.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "connection",
                workspaceName: "ws1",
                resourceName: "conn1",
            });

            expect(mockApiClient.deleteStreamConnection).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });
    });

    describe("deleteWorkspace", () => {
        it("should include impact note when workspace has connections and processors", async () => {
            mockApiClient.listStreamConnections.mockResolvedValue({
                results: [{ name: "c1" }, { name: "c2" }, { name: "c3" }],
            });
            mockApiClient.getStreamProcessors.mockResolvedValue({
                results: [{ name: "p1" }, { name: "p2" }],
            });
            mockApiClient.deleteStreamWorkspace.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "workspace",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("2 processor(s)");
            expect((result.content[0] as { text: string }).text).toContain("3 connection(s)");
        });

        it("should not include impact note for empty workspace", async () => {
            mockApiClient.listStreamConnections.mockResolvedValue({ results: [] });
            mockApiClient.getStreamProcessors.mockResolvedValue({ results: [] });
            mockApiClient.deleteStreamWorkspace.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "workspace",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).not.toContain("processor(s)");
            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });

        it("should proceed without impact note when count APIs fail", async () => {
            mockApiClient.listStreamConnections.mockRejectedValue(new Error("fail"));
            mockApiClient.getStreamProcessors.mockRejectedValue(new Error("fail"));
            mockApiClient.deleteStreamWorkspace.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "workspace",
                workspaceName: "ws1",
            });

            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });
    });

    describe("deletePrivateLink", () => {
        it("should call correct API and return confirmation", async () => {
            mockApiClient.deletePrivateLinkConnection.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "privatelink",
                resourceName: "pl-123",
            });

            expect(mockApiClient.deletePrivateLinkConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", connectionId: "pl-123" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("pl-123");
            expect((result.content[0] as { text: string }).text).toContain("deletion initiated");
        });
    });

    describe("deletePeering", () => {
        it("should call correct API and return confirmation", async () => {
            mockApiClient.deleteVpcPeeringConnection.mockResolvedValue({});

            const result = await tool["execute"]({
                ...baseArgs,
                resource: "peering",
                resourceName: "peer-456",
            });

            expect(mockApiClient.deleteVpcPeeringConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", id: "peer-456" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("peer-456");
        });
    });

    describe("getConfirmationMessage", () => {
        it("should return workspace deletion warning", () => {
            const msg = tool["getConfirmationMessage"]({
                ...baseArgs,
                resource: "workspace",
                workspaceName: "ws1",
            });
            expect(msg).toContain("delete workspace");
            expect(msg).toContain("ALL connections and processors");
        });

        it("should return processor deletion warning", () => {
            const msg = tool["getConfirmationMessage"]({
                ...baseArgs,
                resource: "processor",
                workspaceName: "ws1",
                resourceName: "proc1",
            });
            expect(msg).toContain("delete processor");
            expect(msg).toContain("checkpoints");
        });

        it("should return connection deletion warning", () => {
            const msg = tool["getConfirmationMessage"]({
                ...baseArgs,
                resource: "connection",
                workspaceName: "ws1",
                resourceName: "conn1",
            });
            expect(msg).toContain("delete connection");
        });

        it("should return privatelink deletion warning", () => {
            const msg = tool["getConfirmationMessage"]({
                ...baseArgs,
                resource: "privatelink",
                resourceName: "pl-1",
            });
            expect(msg).toContain("PrivateLink");
        });

        it("should return peering deletion warning", () => {
            const msg = tool["getConfirmationMessage"]({
                ...baseArgs,
                resource: "peering",
                resourceName: "peer-1",
            });
            expect(msg).toContain("VPC peering");
        });
    });
});
