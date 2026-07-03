import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import {
    PauseResumeClusterTool,
    PauseResumeClusterArgsShape,
} from "./pauseResumeCluster.js";
import { z } from "zod";
import type { ISession } from "@mongodb-js/mcp-types";
import type { UserConfig } from "@mongodb-js/mcp-cli";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-types";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import type { Keychain } from "@mongodb-js/mcp-core";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const CLUSTER_NAME = "my-cluster";
const BASE_ARGS = { projectId: PROJECT_ID, clusterName: CLUSTER_NAME };
const UPDATE_RESULT = { id: "cluster-id" };

describe("PauseResumeClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockDisconnect: ReturnType<typeof vi.fn>;
    let tool: PauseResumeClusterTool;

    function buildTool(connectedCluster?: AtlasClusterConnectionInfo): PauseResumeClusterTool {
        mockApiClient = {
            updateCluster: vi.fn().mockResolvedValue(UPDATE_RESULT),
        };

        mockDisconnect = vi.fn().mockResolvedValue(undefined);

        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession: Partial<ISession> = {
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: connectedCluster,
            disconnect: mockDisconnect as unknown as () => Promise<void>,
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
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: PauseResumeClusterTool.toolName,
            category: "atlas",
            operationType: PauseResumeClusterTool.operationType,
            session: mockSession as ISession,
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

        it("disconnects and mentions it in the response when pausing the connected cluster", async () => {
            tool = buildTool(connectedCluster);

            const result = await exec({ ...BASE_ARGS, action: "PAUSE" });

            expect(mockDisconnect).toHaveBeenCalledTimes(1);
            const text = (result.content[0] as { text: string }).text;
            expect(text).toContain("disconnected");
            expect(text).toContain(CLUSTER_NAME);
            expect(result.structuredContent).toMatchObject({ disconnected: true });
        });

        it("does not disconnect when pausing a different cluster", async () => {
            tool = buildTool({ ...connectedCluster, clusterName: "other-cluster" });

            await exec({ ...BASE_ARGS, action: "PAUSE" });

            expect(mockDisconnect).not.toHaveBeenCalled();
        });
    });

    describe("telemetry metadata", () => {
        it("resolves all fields from structuredContent on success", async () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const result = await exec(args);

            const metadata = tool["resolveTelemetryMetadata"](args as never, { result: result as never });
            expect(metadata.cluster_id).toBe("cluster-id");
            expect(metadata.action).toBe("PAUSE");
            expect(metadata.project_id).toBe(PROJECT_ID);
        });

        it("returns empty metadata fields when result has no structuredContent", () => {
            const args = { ...BASE_ARGS, action: "PAUSE" as const };
            const metadata = tool["resolveTelemetryMetadata"](args as never, {
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
