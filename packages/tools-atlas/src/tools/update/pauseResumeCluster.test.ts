import { describe, it, expect, vi, beforeEach } from "vitest";
import { PauseResumeClusterTool, PauseResumeClusterArgsShape } from "./pauseResumeCluster.js";
import { z } from "zod";
import type { IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, ICompositeLogger } from "@mongodb-js/mcp-types";
import { CompositeLogger, Keychain } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-types";
import {
    MCPConnectionStore,
    type ConnectionRegistry,
    DeviceId,
    FakeConnectionManager,
} from "@mongodb-js/mcp-tools-mongodb";
import type { ConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import { UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";
import type { AtlasToolServer } from "../../atlasTool.js";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";

const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

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
        } as unknown as ICompositeLogger;

        class TestStore extends MCPConnectionStore {
            protected override createConnectionManager(): ConnectionManager {
                return new FakeConnectionManager();
            }
        }
        connectionRegistry = new TestStore({
            options: defaultTestConfig,
            logger: new CompositeLogger(),
            deviceId: DeviceId.create(new CompositeLogger()),
        }).view();

        const mockSession: Partial<AtlasToolServer> = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectionRegistry,
            keychain: new Keychain(),
            config: {
                transport: "stdio",
                readOnly: false,
                disabledTools: [],
                confirmationRequiredTools: [],
                previewFeatures: [],
            } as unknown as IAtlasConfig,
        };

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = createMockElicitation();

        const server: AtlasToolServer = {
            ...mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        } as unknown as AtlasToolServer;

        return new PauseResumeClusterTool(server);
    }

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["invoke"](z.object(PauseResumeClusterArgsShape).parse(args), {
            request: { config: (tool as unknown as { server: AtlasToolServer }).server.config, signal: new AbortController().signal },
        } as unknown as ToolExecutionContext);

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
                disconnectedConnectionIds: [],
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
                disconnectedConnectionIds: [],
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
            expect(result.structuredContent).toMatchObject({ disconnectedConnectionIds: [entry.connectionId] });
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
            expect(result.structuredContent).toMatchObject({ disconnectedConnectionIds: [] });
        });
    });

    describe("telemetry metadata", () => {
        it("resolves all fields from structuredContent on success", async () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const result = await exec(args);

            const metadata = await tool["resolveTelemetryMetadata"](args, { result: result });
            expect(metadata.cluster_id).toBe("cluster-id");
            expect(metadata.action).toBe("PAUSE");
            expect(metadata.project_id).toBe(PROJECT_ID);
        });

        it("returns empty metadata fields when result has no structuredContent", async () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const metadata = await tool["resolveTelemetryMetadata"](args, {
                result: { content: [] },
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
