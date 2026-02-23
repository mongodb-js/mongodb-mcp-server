import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "../../src/common/session.js";
import type { ToolConstructorParams } from "../../src/tools/tool.js";
import type { UserConfig } from "../../src/common/config/userConfig.js";
import type { Telemetry } from "../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../src/elicitation.js";
import { UIRegistry } from "../../src/ui/registry/index.js";
import { NullLogger } from "../utils/index.js";
import { ApiClientError } from "../../src/common/atlas/apiClientError.js";
import { CreateBackupSnapshotTool } from "../../src/tools/atlas/create/createBackupSnapshot.js";
import { ListBackupSnapshotsTool } from "../../src/tools/atlas/read/listBackupSnapshots.js";
import { GetBackupSnapshotTool } from "../../src/tools/atlas/read/getBackupSnapshot.js";
import { RestoreFromSnapshotTool } from "../../src/tools/atlas/create/restoreFromSnapshot.js";
import { GetRestoreJobTool } from "../../src/tools/atlas/read/getRestoreJob.js";

type ToolCallback = (args: Record<string, unknown>, context: unknown) => Promise<CallToolResult>;

describe("Atlas backup/restore tools", () => {
    let mockConfig: UserConfig;
    let mockTelemetry: Telemetry;
    let mockEmitEvents: ReturnType<typeof vi.fn>;
    let mockElicitation: Elicitation;
    let mockLogger: NullLogger;

    beforeEach(() => {
        mockConfig = {
            apiClientId: "test-client-id",
            apiClientSecret: "test-client-secret",
            confirmationRequiredTools: [],
            previewFeatures: [],
            disabledTools: [],
        } as unknown as UserConfig;

        mockEmitEvents = vi.fn();
        mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: mockEmitEvents,
        } as unknown as Telemetry;

        mockElicitation = {
            requestConfirmation: vi.fn().mockResolvedValue(true),
        } as unknown as Elicitation;

        mockLogger = new NullLogger();
    });

    function registerTool(tool: { register: (server: unknown) => boolean }): ToolCallback {
        let callback: ToolCallback | undefined;
        const registered = tool.register({
            mcpServer: {
                registerTool: (
                    _name: string,
                    _config: unknown,
                    cb: (args: Record<string, unknown>, context: unknown) => Promise<CallToolResult>
                ) => {
                    callback = cb;
                    return { enabled: true, disable: vi.fn(), enable: vi.fn() };
                },
            },
        } as unknown);

        expect(registered).toBe(true);
        if (!callback) {
            throw new Error("Tool callback was not registered");
        }
        return callback;
    }

    function createParams(apiClient: Record<string, unknown>): ToolConstructorParams {
        return {
            name: "test-tool",
            category: "atlas",
            operationType: "read",
            session: { logger: mockLogger, apiClient } as unknown as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            uiRegistry: new UIRegistry(),
        };
    }

    function getFirstText(result: CallToolResult): string {
        const content = result.content[0];
        if (!content || content.type !== "text") {
            throw new Error("Expected first content item to be text");
        }
        return content.text;
    }

    function expectLastProjectTelemetry(projectId: string): void {
        const events = mockEmitEvents.mock.lastCall?.[0] as unknown as Array<{
            properties?: { project_id?: string };
        }>;
        expect(events[0]?.properties?.project_id).toBe(projectId);
    }

    it("creates backup snapshot and emits project telemetry", async () => {
        const apiClient = {
            takeSnapshots: vi.fn().mockResolvedValue({
                id: "6997601e234caf39b33d4fbb",
                snapshotType: "onDemand",
                status: "queued",
                description: "test snapshot",
            } as never),
        };

        const tool = new CreateBackupSnapshotTool({
            ...createParams(apiClient),
            name: CreateBackupSnapshotTool.toolName,
            operationType: CreateBackupSnapshotTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            { projectId: "0123456789abcdef01234567", clusterName: "cluster-a", retentionInDays: 1 },
            {}
        );

        expect(result.isError).toBeUndefined();
        expect(getFirstText(result)).toContain("On-demand backup snapshot created");
        expect(apiClient.takeSnapshots).toHaveBeenCalledWith({
            params: { path: { groupId: "0123456789abcdef01234567", clusterName: "cluster-a" } },
            body: { retentionInDays: 1 },
        });
        expect(mockEmitEvents).toHaveBeenCalled();
        expectLastProjectTelemetry("0123456789abcdef01234567");
    });

    it("lists backup snapshots and emits project telemetry", async () => {
        const apiClient = {
            listBackupSnapshots: vi.fn().mockResolvedValue({
                results: [{ id: "6997601e234caf39b33d4fbb", snapshotType: "onDemand", status: "completed" }],
            } as never),
        };

        const tool = new ListBackupSnapshotsTool({
            ...createParams(apiClient),
            name: ListBackupSnapshotsTool.toolName,
            operationType: ListBackupSnapshotsTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            { projectId: "0123456789abcdef01234567", clusterName: "cluster-a", limit: 10, page: 1 },
            {}
        );

        expect(result.isError).toBeUndefined();
        expect(getFirstText(result)).toContain("Found 1 backup snapshots");
        expect(apiClient.listBackupSnapshots).toHaveBeenCalledWith({
            params: {
                query: { itemsPerPage: 10, pageNum: 1 },
                path: { groupId: "0123456789abcdef01234567", clusterName: "cluster-a" },
            },
        });
        expectLastProjectTelemetry("0123456789abcdef01234567");
    });

    it("gets backup snapshot by id", async () => {
        const apiClient = {
            getClusterBackupSnapshot: vi.fn().mockResolvedValue({
                id: "6997601e234caf39b33d4fbb",
                snapshotType: "onDemand",
                status: "completed",
            } as never),
        };

        const tool = new GetBackupSnapshotTool({
            ...createParams(apiClient),
            name: GetBackupSnapshotTool.toolName,
            operationType: GetBackupSnapshotTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            {
                projectId: "0123456789abcdef01234567",
                clusterName: "cluster-a",
                snapshotId: "6997601e234caf39b33d4fbb",
            },
            {}
        );

        expect(result.isError).toBeUndefined();
        expect(getFirstText(result)).toContain("Backup snapshot");
        expect(apiClient.getClusterBackupSnapshot).toHaveBeenCalledWith({
            params: {
                path: {
                    groupId: "0123456789abcdef01234567",
                    clusterName: "cluster-a",
                    snapshotId: "6997601e234caf39b33d4fbb",
                },
            },
        });
    });

    it("creates restore job from snapshot", async () => {
        const apiClient = {
            createBackupRestoreJob: vi.fn().mockResolvedValue({
                id: "6997601e234caf39b33d4fcc",
                deliveryType: "automated",
                snapshotId: "6997601e234caf39b33d4fbb",
                targetGroupId: "89abcdef0123456701234567",
                targetClusterName: "cluster-b",
                failed: false,
                cancelled: false,
            } as never),
        };

        const tool = new RestoreFromSnapshotTool({
            ...createParams(apiClient),
            name: RestoreFromSnapshotTool.toolName,
            operationType: RestoreFromSnapshotTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            {
                projectId: "0123456789abcdef01234567",
                clusterName: "cluster-a",
                snapshotId: "6997601e234caf39b33d4fbb",
                targetProjectId: "89abcdef0123456701234567",
                targetClusterName: "cluster-b",
            },
            {}
        );

        expect(result.isError).toBeUndefined();
        expect(getFirstText(result)).toContain("Restore job created");
        expect(apiClient.createBackupRestoreJob).toHaveBeenCalledWith({
            params: { path: { groupId: "0123456789abcdef01234567", clusterName: "cluster-a" } },
            body: {
                deliveryType: "automated",
                snapshotId: "6997601e234caf39b33d4fbb",
                targetGroupId: "89abcdef0123456701234567",
                targetClusterName: "cluster-b",
            },
        });
    });

    it("gets restore job status", async () => {
        const apiClient = {
            getBackupRestoreJob: vi.fn().mockResolvedValue({
                id: "6997601e234caf39b33d4fcc",
                deliveryType: "automated",
                failed: false,
                cancelled: false,
            } as never),
        };

        const tool = new GetRestoreJobTool({
            ...createParams(apiClient),
            name: GetRestoreJobTool.toolName,
            operationType: GetRestoreJobTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            {
                projectId: "0123456789abcdef01234567",
                clusterName: "cluster-a",
                restoreJobId: "6997601e234caf39b33d4fcc",
            },
            {}
        );

        expect(result.isError).toBeUndefined();
        expect(getFirstText(result)).toContain("Restore job");
        expect(apiClient.getBackupRestoreJob).toHaveBeenCalledWith({
            params: {
                path: {
                    groupId: "0123456789abcdef01234567",
                    clusterName: "cluster-a",
                    restoreJobId: "6997601e234caf39b33d4fcc",
                },
            },
        });
    });

    it("returns helpful error for forbidden Atlas API response", async () => {
        const apiClient = {
            getBackupRestoreJob: vi.fn().mockRejectedValue(
                ApiClientError.fromError(
                    { status: 403, statusText: "Forbidden" } as Response,
                    {
                        detail: "Forbidden",
                    } as never
                ) as never
            ),
        };

        const tool = new GetRestoreJobTool({
            ...createParams(apiClient),
            name: GetRestoreJobTool.toolName,
            operationType: GetRestoreJobTool.operationType,
        });
        const callback = registerTool(tool as unknown as { register: (server: unknown) => boolean });

        const result = await callback(
            {
                projectId: "0123456789abcdef01234567",
                clusterName: "cluster-a",
                restoreJobId: "6997601e234caf39b33d4fcc",
            },
            {}
        );

        expect(result.isError).toBe(true);
        expect(getFirstText(result)).toContain("Forbidden API Error");
    });
});
