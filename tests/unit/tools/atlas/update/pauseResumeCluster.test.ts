import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import {
    PauseResumeClusterTool,
    PauseResumeClusterArgsShape,
} from "../../../../../src/tools/atlas/update/pauseResumeCluster.js";
import { z } from "zod";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import type { AtlasClusterConnectionInfo } from "../../../../../src/common/connectionInfo.js";
import { MCPConnectionStore, type ConnectionRegistry } from "../../../../../src/common/connectionRegistry.js";
import { DeviceId } from "../../../../../src/helpers/deviceId.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";
import { FakeConnectionManager } from "../../../mocks/connectionManager.js";
import { defaultTestConfig } from "../../../../integration/helpers.js";
import type { Keychain } from "../../../../../src/lib.js";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const CLUSTER_NAME = "my-cluster";
const BASE_ARGS = { projectId: PROJECT_ID, clusterName: CLUSTER_NAME };
const UPDATE_RESULT = { id: "cluster-id" };

describe("PauseResumeClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let connectionRegistry: ConnectionRegistry;
    let tool: PauseResumeClusterTool;

    function buildTool(): PauseResumeClusterTool {
        mockApiClient = {
            updateCluster: vi.fn().mockResolvedValue(UPDATE_RESULT),
        };

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        connectionRegistry = new MCPConnectionStore({
            userConfig: defaultTestConfig,
            logger: new CompositeLogger(),
            deviceId: DeviceId.create(new CompositeLogger()),
            createConnectionManager: (): FakeConnectionManager => new FakeConnectionManager(),
        }).view();

        const mockSession: Partial<Session> = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectionRegistry,
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
            name: PauseResumeClusterTool.toolName,
            category: "atlas",
            operationType: PauseResumeClusterTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        return new PauseResumeClusterTool(params);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(PauseResumeClusterArgsShape).parse(args) as never, {} as never);

    beforeEach(() => {
        tool = buildTool();
    });

    describe("request body", () => {
        it("sends paused: true for PAUSE action", async () => {
            await exec({ ...BASE_ARGS, action: "PAUSE" });

            expect(mockApiClient.updateCluster).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: PROJECT_ID, clusterName: CLUSTER_NAME } },
                    body: { paused: true },
                },
                expect.anything()
            );
        });

        it("sends paused: false for RESUME action", async () => {
            await exec({ ...BASE_ARGS, action: "RESUME" });

            expect(mockApiClient.updateCluster).toHaveBeenCalledWith(
                {
                    params: { path: { groupId: PROJECT_ID, clusterName: CLUSTER_NAME } },
                    body: { paused: false },
                },
                expect.anything()
            );
        });
    });

    describe("response", () => {
        it("returns expected text and structuredContent for PAUSE", async () => {
            const result = await exec({ ...BASE_ARGS, action: "PAUSE" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain(CLUSTER_NAME);
            expect(text).toContain(PROJECT_ID);
            expect(text).toContain("paused");
            expect(result.structuredContent).toMatchObject({
                clusterName: CLUSTER_NAME,
                action: "PAUSE",
                clusterId: "cluster-id",
                disconnected: false,
            });
        });

        it("returns expected text and structuredContent for RESUME", async () => {
            const result = await exec({ ...BASE_ARGS, action: "RESUME" });

            expect(result.isError).toBeFalsy();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain(CLUSTER_NAME);
            expect(text).toContain(PROJECT_ID);
            expect(text).toContain("atlas-inspect-cluster");
            expect(text).toContain("IDLE");
            expect(result.structuredContent).toMatchObject({
                clusterName: CLUSTER_NAME,
                action: "RESUME",
                clusterId: "cluster-id",
                disconnected: false,
            });
        });
    });

    describe("disconnect on pause", () => {
        const connectedCluster: AtlasClusterConnectionInfo = {
            projectId: PROJECT_ID,
            clusterName: CLUSTER_NAME,
            instanceType: "DEDICATED",
            username: "test-user",
            provider: "AWS",
            region: "US_EAST_1",
            expiryDate: new Date(Date.now() + 3_600_000),
        };

        it("revokes matching connections and mentions them in the response when pausing the cluster", async () => {
            const entry = await connectionRegistry.connect({
                settings: { connectionString: "mongodb://localhost:27017", atlas: connectedCluster },
            });

            const result = await exec({ ...BASE_ARGS, action: "PAUSE" });

            await expect(connectionRegistry.peek(entry.connectionId)).resolves.toBeUndefined();
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("disconnected");
            expect(text).toContain(CLUSTER_NAME);
            expect(text).toContain(`"${entry.connectionId}"`);
            expect(result.structuredContent).toMatchObject({ disconnected: true });
        });

        it("does not disconnect connections to a different cluster", async () => {
            const entry = await connectionRegistry.connect({
                settings: {
                    connectionString: "mongodb://localhost:27017",
                    atlas: { ...connectedCluster, clusterName: "other-cluster" },
                },
            });

            const result = await exec({ ...BASE_ARGS, action: "PAUSE" });

            await expect(connectionRegistry.peek(entry.connectionId)).resolves.toBe(entry);
            expect(result.structuredContent).toMatchObject({ disconnected: false });
        });
    });

    describe("telemetry metadata", () => {
        it("resolves all fields from structuredContent on success", async () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const result = await exec(args);

            const metadata = await tool["resolveTelemetryMetadata"](args as never, { result: result as never });
            expect(metadata.cluster_id).toBe("cluster-id");
            expect(metadata.action).toBe("PAUSE");
            expect(metadata.project_id).toBe(PROJECT_ID);
        });

        it("returns empty metadata fields when result has no structuredContent", async () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const metadata = await tool["resolveTelemetryMetadata"](args as never, {
                result: { content: [] } as never,
            });

            expect(metadata.cluster_id).toBeUndefined();
            expect(metadata.action).toBeUndefined();
        });
    });

    describe("error handling", () => {
        it("returns error when updateCluster API call fails", async () => {
            mockApiClient.updateCluster!.mockRejectedValue(new Error("network error"));

            const result = await exec({ ...BASE_ARGS, action: "PAUSE" });

            expect(result.isError).toBe(true);
        });
    });
});
