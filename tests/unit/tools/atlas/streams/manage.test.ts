/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { StreamsManageTool } from "../../../../../src/tools/atlas/streams/manage.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("StreamsManageTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockLogger: Record<string, ReturnType<typeof vi.fn>>;
    let tool: StreamsManageTool;

    beforeEach(() => {
        mockApiClient = {
            getStreamProcessor: vi.fn(),
            startStreamProcessor: vi.fn().mockResolvedValue({}),
            startStreamProcessorWith: vi.fn().mockResolvedValue({}),
            stopStreamProcessor: vi.fn().mockResolvedValue({}),
            updateStreamProcessor: vi.fn().mockResolvedValue({}),
            getStreamWorkspace: vi.fn().mockResolvedValue({
                streamConfig: { maxTierSize: "SP50" },
                dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
            }),
            updateStreamWorkspace: vi.fn().mockResolvedValue({}),
            getStreamConnection: vi.fn().mockResolvedValue({ name: "conn1", type: "Kafka", state: "READY" }),
            updateStreamConnection: vi.fn().mockResolvedValue({}),
            acceptVpcPeeringConnection: vi.fn().mockResolvedValue({}),
            rejectVpcPeeringConnection: vi.fn().mockResolvedValue({}),
        };

        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };
        const typedLogger = mockLogger as unknown as CompositeLogger;

        const mockSession = {
            logger: typedLogger,
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
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new StreamsManageTool(params);
    });

    const baseArgs = { projectId: "proj1", workspaceName: "ws1" };
    // Tests were written against the pre-MCP-483 flat args shape. The tool now
    // expects { projectId, workspaceName, operation: [{ action, ...params }] }. This
    // helper wraps flat test args into the new shape so we don't churn every assertion.
    const wrap = (args: Record<string, unknown>): Record<string, unknown> => {
        const { projectId, workspaceName, action, ...rest } = args;
        if (action === undefined) {
            return { projectId, workspaceName, operation: [] };
        }
        return { projectId, workspaceName, operation: [{ action, ...rest }] };
    };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) => tool["execute"](wrap(args) as never);

    describe("start-processor", () => {
        it("should start a STOPPED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
            });

            expect(mockApiClient.startStreamProcessor).toHaveBeenCalledOnce();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("started");
            expect(text).toContain("Billing");
            expect(text).toContain("stop-processor");
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

        it("should return error when tier exceeds workspace max tier", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            mockApiClient.getStreamWorkspace!.mockResolvedValue({ streamConfig: { maxTierSize: "SP10" } });

            const result = await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                tier: "SP50",
            });

            expect(result.isError).toBe(true);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("Cannot start processor");
            expect(text).toContain("SP50");
            expect(text).toContain("SP10");
            expect(mockApiClient.startStreamProcessor).not.toHaveBeenCalled();
            expect(mockApiClient.startStreamProcessorWith).not.toHaveBeenCalled();
        });

        it("should proceed when tier is within workspace max", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            mockApiClient.getStreamWorkspace!.mockResolvedValue({ streamConfig: { maxTierSize: "SP50" } });

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
        });

        it("should proceed with tier when workspace fetch fails (soft check)", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            mockApiClient.getStreamWorkspace!.mockRejectedValue(new Error("API error"));

            await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                tier: "SP50",
            });

            expect(mockApiClient.startStreamProcessorWith).toHaveBeenCalled();
        });

        it("should use startStreamProcessorWith when startAtOperationTime is set", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                startAtOperationTime: "2026-01-01T00:00:00Z",
            });

            expect(mockApiClient.startStreamProcessorWith).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ startAtOperationTime: "2026-01-01T00:00:00Z" }),
                })
            );
        });

        it("should include no-checkpoint note when resumeFromCheckpoint is false", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                resumeFromCheckpoint: false,
            });

            expect((result.content[0] as { text: string }).text).toContain("from the beginning");
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

        it("should proceed with stop when getStreamProcessor throws (error state)", async () => {
            mockApiClient.getStreamProcessor!.mockRejectedValue(new Error("400 Bad Request"));

            const result = await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect(mockApiClient.stopStreamProcessor).toHaveBeenCalledOnce();
            expect((result.content[0] as { text: string }).text).toContain("stopped");
        });

        it("should return not-running message for STOPPED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect((result.content[0] as { text: string }).text).toContain("not running");
            expect((result.content[0] as { text: string }).text).toContain("STOPPED");
            expect(mockApiClient.stopStreamProcessor).not.toHaveBeenCalled();
        });

        it("should return not-running message for CREATED processor", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "CREATED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect((result.content[0] as { text: string }).text).toContain("not running");
            expect((result.content[0] as { text: string }).text).toContain("CREATED");
            expect(mockApiClient.stopStreamProcessor).not.toHaveBeenCalled();
        });

        it("should log debug message when getStreamProcessor throws during stop", async () => {
            mockApiClient.getStreamProcessor!.mockRejectedValue(new Error("500 Internal Server Error"));

            await exec({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    context: "streams-manage",
                    message: expect.stringContaining("500 Internal Server Error"),
                })
            );
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

        it("should rename processor via newName", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });

            const result = await exec({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
                newName: "proc1-renamed",
            });

            expect(mockApiClient.updateStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ name: "proc1-renamed" }),
                })
            );
            expect((result.content[0] as { text: string }).text).toContain("modified");
            expect((result.content[0] as { text: string }).text).toContain("name");
        });

        it("should update only DLQ config", async () => {
            mockApiClient.getStreamProcessor!.mockResolvedValue({ state: "STOPPED", name: "proc1" });
            const dlq = { connectionName: "cluster", db: "mydb", coll: "dlq" };

            const result = await exec({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
                dlq,
            });

            expect(mockApiClient.updateStreamProcessor).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ options: { dlq } }),
                })
            );
            expect((result.content[0] as { text: string }).text).toContain("modified");
            expect((result.content[0] as { text: string }).text).toContain("options");
        });
    });

    describe("update-workspace", () => {
        it("should update workspace with region and tier, including cloudProvider from current workspace", async () => {
            mockApiClient.updateStreamWorkspace!.mockResolvedValue({
                dataProcessRegion: { cloudProvider: "AWS", region: "OREGON_USA" },
                streamConfig: { tier: "SP30" },
            });

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newRegion: "OREGON_USA",
                newTier: "SP30",
            });

            expect(mockApiClient.getStreamWorkspace).toHaveBeenCalled();
            expect(mockApiClient.updateStreamWorkspace).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1" } },
                body: { cloudProvider: "AWS", region: "OREGON_USA", streamConfig: { tier: "SP30" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should update workspace with region only, including cloudProvider from current workspace", async () => {
            mockApiClient.updateStreamWorkspace!.mockResolvedValue({
                dataProcessRegion: { cloudProvider: "AWS", region: "DUBLIN_IRL" },
            });

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newRegion: "DUBLIN_IRL",
            });

            expect(mockApiClient.getStreamWorkspace).toHaveBeenCalled();
            expect(mockApiClient.updateStreamWorkspace).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1" } },
                body: { cloudProvider: "AWS", region: "DUBLIN_IRL" },
            });
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should update workspace with tier only without fetching cloudProvider", async () => {
            mockApiClient.updateStreamWorkspace!.mockResolvedValue({
                dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
                streamConfig: { tier: "SP30" },
            });

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newTier: "SP30",
            });

            expect(mockApiClient.getStreamWorkspace).not.toHaveBeenCalled();
            expect(mockApiClient.updateStreamWorkspace).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1" } },
                body: { streamConfig: { tier: "SP30" } },
            });
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should return error when workspace has no cloudProvider", async () => {
            mockApiClient.getStreamWorkspace!.mockResolvedValue({
                dataProcessRegion: { region: "VIRGINIA_USA" },
            });

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newRegion: "OREGON_USA",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("cloud provider");
            expect(mockApiClient.updateStreamWorkspace).not.toHaveBeenCalled();
        });

        it("should succeed when update response omits dataProcessRegion", async () => {
            mockApiClient.updateStreamWorkspace!.mockResolvedValue({});

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newRegion: "OREGON_USA",
            });

            expect(result.isError).toBeUndefined();
            expect((result.content[0] as { text: string }).text).toContain("updated");
        });

        it("should return error when API response shows region did not change", async () => {
            mockApiClient.updateStreamWorkspace!.mockResolvedValue({
                dataProcessRegion: { cloudProvider: "AWS", region: "VIRGINIA_USA" },
            });

            const result = await exec({
                ...baseArgs,
                action: "update-workspace",
                newRegion: "INVALID_REGION",
            });

            expect(result.isError).toBe(true);
            expect((result.content[0] as { text: string }).text).toContain("Failed to update workspace region");
            expect((result.content[0] as { text: string }).text).toContain("INVALID_REGION");
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

        it("should normalize bootstrapServers array to comma-separated string", async () => {
            await exec({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
                connectionConfig: { bootstrapServers: ["broker1:9092", "broker2:9092"] },
            });

            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        bootstrapServers: "broker1:9092,broker2:9092",
                    }),
                })
            );
        });

        it("should normalize schemaRegistryUrls string to array", async () => {
            await exec({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
                connectionConfig: { schemaRegistryUrls: "https://sr.example.com" },
            });

            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        schemaRegistryUrls: ["https://sr.example.com"],
                    }),
                })
            );
        });

        it("should omit type from update body when getStreamConnection returns no type", async () => {
            mockApiClient.getStreamConnection = vi.fn().mockResolvedValue({
                name: "conn1",
                state: "READY",
            });

            await exec({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
                connectionConfig: { bootstrapServers: "broker:9092" },
            });

            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.not.objectContaining({ type: expect.anything() }),
                })
            );
            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ name: "conn1" }),
                })
            );
        });

        it("should include connection type from existing connection in the update body", async () => {
            mockApiClient.getStreamConnection = vi.fn().mockResolvedValue({
                name: "conn1",
                type: "Kafka",
                state: "READY",
            });

            await exec({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
                connectionConfig: {
                    authentication: { mechanism: "PLAIN", username: "new-user", password: "new-pass" },
                },
            });

            expect(mockApiClient.updateStreamConnection).toHaveBeenCalledWith({
                params: { path: { groupId: "proj1", tenantName: "ws1", connectionName: "conn1" } },
                body: expect.objectContaining({ type: "Kafka" }),
            });
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
    });

    describe("getConfirmationMessage", () => {
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
        const confirmMsg = (args: Record<string, unknown>) => tool["getConfirmationMessage"](wrap(args) as never);

        it("should include billing warning for start-processor", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
            });
            expect(msg).toContain("billing");
            expect(msg).toContain("proc1");
        });

        it("should include checkpoint loss warning when resumeFromCheckpoint is false", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                resumeFromCheckpoint: false,
            });
            expect(msg).toContain("resumeFromCheckpoint is false");
            expect(msg).toContain("window state will be permanently lost");
        });

        it("should not include checkpoint warning when resumeFromCheckpoint is true or unset", () => {
            const msgTrue = confirmMsg({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
                resumeFromCheckpoint: true,
            });
            expect(msgTrue).not.toContain("window state will be permanently lost");

            const msgUnset = confirmMsg({
                ...baseArgs,
                action: "start-processor",
                resourceName: "proc1",
            });
            expect(msgUnset).not.toContain("window state will be permanently lost");
        });

        it("should mention in-flight data for stop-processor", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "stop-processor",
                resourceName: "proc1",
            });
            expect(msg).toContain("In-flight data");
            expect(msg).toContain("proc1");
        });

        it("should warn about pipeline changes for modify-processor", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "modify-processor",
                resourceName: "proc1",
            });
            expect(msg).toContain("modify");
            expect(msg).toContain("proc1");
        });

        it("should mention workspace update for update-workspace", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "update-workspace",
            });
            expect(msg).toContain("update workspace");
            expect(msg).toContain("ws1");
        });

        it("should mention connection update for update-connection", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "update-connection",
                resourceName: "conn1",
            });
            expect(msg).toContain("update connection");
            expect(msg).toContain("conn1");
        });

        it("should mention peering ID for accept-peering", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "accept-peering",
                peeringId: "peer-1",
            });
            expect(msg).toContain("accept");
            expect(msg).toContain("peer-1");
        });

        it("should warn about irreversibility for reject-peering", () => {
            const msg = confirmMsg({
                ...baseArgs,
                action: "reject-peering",
                peeringId: "peer-1",
            });
            expect(msg).toContain("reject");
            expect(msg).toContain("cannot be undone");
            expect(msg).toContain("peer-1");
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

    describe("schema validation", () => {
        const validProjectId = "507f1f77bcf86cd799439011";
        const validBase = { projectId: validProjectId, workspaceName: "ws1" };
        const parse = (args: Record<string, unknown>): { success: boolean } =>
            z.object(tool["argsShape"]).safeParse(args);

        it.each([
            ["start-processor without resourceName", { action: "start-processor" }],
            ["stop-processor without resourceName", { action: "stop-processor" }],
            ["modify-processor without resourceName", { action: "modify-processor" }],
            ["update-connection without connectionConfig", { action: "update-connection", resourceName: "c1" }],
            ["update-connection without resourceName", { action: "update-connection", connectionConfig: {} }],
            [
                "accept-peering without peeringId",
                { action: "accept-peering", requesterAccountId: "123", requesterVpcId: "vpc-1" },
            ],
            [
                "accept-peering without requesterAccountId",
                { action: "accept-peering", peeringId: "p1", requesterVpcId: "vpc-1" },
            ],
            [
                "accept-peering without requesterVpcId",
                { action: "accept-peering", peeringId: "p1", requesterAccountId: "123" },
            ],
            ["reject-peering without peeringId", { action: "reject-peering" }],
            ["unknown action", { action: "invalid-action" }],
        ])("rejects %s", (_desc, operation) => {
            const result = parse({ ...validBase, operation: [operation] });
            expect(result.success).toBe(false);
        });

        it("accepts empty operation array at schema level (runtime surfaces missing-op error)", () => {
            const result = parse({ ...validBase, operation: [] });
            expect(result.success).toBe(true);
        });

        it("accepts valid start-processor operation", () => {
            const result = parse({
                ...validBase,
                operation: [{ action: "start-processor", resourceName: "p1", tier: "SP10" }],
            });
            expect(result.success).toBe(true);
        });
    });

    describe("execute with missing operation", () => {
        it("throws when operation array is empty", async () => {
            await expect(tool["execute"]({ ...baseArgs, operation: [] } as never)).rejects.toThrow(
                "No operation provided"
            );
        });
    });
});
