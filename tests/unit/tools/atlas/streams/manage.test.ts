/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsManageTool } from "../../../../../src/tools/atlas/streams/manage.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logger.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";

describe("StreamsManageTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: StreamsManageTool;

    beforeEach(() => {
        mockApiClient = {
            getStreamProcessor: vi.fn(),
            startStreamProcessor: vi.fn().mockResolvedValue({}),
            startStreamProcessorWith: vi.fn().mockResolvedValue({}),
            stopStreamProcessor: vi.fn().mockResolvedValue({}),
            updateStreamProcessor: vi.fn().mockResolvedValue({}),
            getStreamWorkspace: vi.fn().mockResolvedValue({ streamConfig: { maxTierSize: "SP50" } }),
            updateStreamWorkspace: vi.fn().mockResolvedValue({}),
            updateStreamConnection: vi.fn().mockResolvedValue({}),
            acceptVpcPeeringConnection: vi.fn().mockResolvedValue({}),
            rejectVpcPeeringConnection: vi.fn().mockResolvedValue({}),
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
            name: StreamsManageTool.toolName,
            category: "atlas",
            operationType: StreamsManageTool.operationType,
            session: mockSession,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsManageTool(params);
    });

    const baseArgs = { projectId: "proj1", workspaceName: "ws1" };
    // Helper to call execute with partial args (tests validate missing fields at runtime)
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](args as never);

    describe("start-processor", () => {
        it("should start a STOPPED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
            });

            expect(mockApiClient.startStreamProcessor).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("started");
        });

        it("should return already-running message for STARTED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STARTED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("already running");
            expect(mockApiClient.startStreamProcessor).not.toHaveBeenCalled();
        });

        it("should use startStreamProcessorWith when tier override is provided", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                tier: "SP30",
            });

            expect(mockApiClient.startStreamProcessorWith).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ tier: "SP30" }),
                })
            );
            expect(mockApiClient.startStreamProcessor).not.toHaveBeenCalled();
        });

        it("should use startStreamProcessorWith when resumeFromCheckpoint is set", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                resumeFromCheckpoint: false,
            });

            expect(mockApiClient.startStreamProcessorWith).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ resumeFromCheckpoint: false }),
                })
            );
        });

        it("should throw when resourceName is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    action: "start-processor",
                })
            ).rejects.toThrow("resourceName is required");
        });
    });

    describe("stop-processor", () => {
        it("should stop a STARTED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STARTED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect(mockApiClient.stopStreamProcessor).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("stopped");
        });

        it("should return already-stopped message for STOPPED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect((result.content[0] as { text: string }).text).toContain("already stopped");
            expect(mockApiClient.stopStreamProcessor).not.toHaveBeenCalled();
        });
    });

    describe("modify-processor", () => {
        it("should return error when processor is STARTED", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STARTED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
                pipeline: [{ $source: { connectionName: "src" } }],
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("must be stopped");
            expect(mockApiClient.updateStreamProcessor).not.toHaveBeenCalled();
        });

        it("should update processor with new pipeline when STOPPED", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            const newPipeline = [{ $source: { connectionName: "new-src" } }];

            const result = await exec({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
                pipeline: newPipeline,
            });

            expect(mockApiClient.updateStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ pipeline: newPipeline }),
                })
            );
            expect((result.content[0] as { text: string }).text).toContain("modified");
        });

        it("should return error when no modifications specified", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("No modifications");
        });
    });

    describe("update-workspace", () => {
        it("should update workspace with new tier", async () => {
            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newTier: "SP30",
            });

            expect(mockApiClient.updateStreamWorkspace).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1" } },
                body: { streamConfig: { tier: "SP30" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should return error when no updates specified", async () => {
            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("No updates specified");
        });
    });

    describe("update-connection", () => {
        it("should update connection with new config", async () => {
            const result = await exec({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
                connectionConfig: { bootstrapServers: "new-broker:9092" },
            });

            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("conn1");
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should throw when connectionConfig is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    action: "update-connection",
                    resourceName: "conn1",
                })
            ).rejects.toThrow("connectionConfig is required");
        });
    });

    describe("accept-peering", () => {
        it("should call correct API with peering params", async () => {
            const result = await exec({
                ...baseArgs,
                action: "accept-peering",
                peeringId: "peer-1",
                requesterAccountId: "123456789",
                requesterVpcId: "vpc-abc",
            });

            expect(mockApiClient.acceptVpcPeeringConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", id: "peer-1" } },
                body: { requesterAccountId: "123456789", requesterVpcId: "vpc-abc" },
            });
            expect((result.content[0] as { text: string }).text).toContain("accepted");
        });

        it("should throw when peeringId is missing", async () => {
            await expect(
                exec({
                    ...baseArgs,
                    action: "accept-peering",
                    requesterAccountId: "123",
                    requesterVpcId: "vpc-1",
                })
            ).rejects.toThrow("peeringId is required");
        });
    });

    describe("reject-peering", () => {
        it("should call correct API", async () => {
            const result = await exec({
                ...baseArgs,
                action: "reject-peering",
                peeringId: "peer-1",
            });

            expect(mockApiClient.rejectVpcPeeringConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", id: "peer-1" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("rejected");
        });
    });
});
