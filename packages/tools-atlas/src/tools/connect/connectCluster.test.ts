import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams, ToolExecutionContext } from "../../../../../src/tools/tool.js";
import { ConnectClusterTool } from "../../../../../src/tools/atlas/connect/connectCluster.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import type { AtlasClusterConnectionInfo } from "../../../../../src/common/connectionInfo.js";
import { MockMetrics } from "../../../mocks/metrics.js";

const ATLAS_INFO: AtlasClusterConnectionInfo = {
    username: "user1",
    projectId: "proj1",
    clusterName: "cluster1",
    instanceType: "DEDICATED",
    expiryDate: new Date(),
};

describe("ConnectClusterTool", () => {
    let mockLogger: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<Session>;
    let tool: ConnectClusterTool;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };

        mockSession = {
            logger: mockLogger as unknown as CompositeLogger,
            apiClient: {} as unknown as ApiClient,
            connectedAtlasCluster: ATLAS_INFO,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
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
            name: ConnectClusterTool.toolName,
            category: "atlas",
            operationType: ConnectClusterTool.operationType,
            session: mockSession as Session,
            config: mockConfig,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
        };

        tool = new ConnectClusterTool(params);
    });

    describe("connectToCluster request ID logging", () => {
        it("includes x-request-id in attempt and success debug logs", async () => {
            const context: ToolExecutionContext = {
                signal: new AbortController().signal,
                requestInfo: { headers: { "x-request-id": "req-connect-abc" } },
            };

            await tool["connectToCluster"]("mongodb://localhost", ATLAS_INFO, context);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining("attempting to connect"),
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    attributes: expect.objectContaining({ "x-request-id": "req-connect-abc" }),
                })
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.objectContaining({
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    message: expect.stringContaining("connected to cluster"),
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    attributes: expect.objectContaining({ "x-request-id": "req-connect-abc" }),
                })
            );
        });

        it("omits x-request-id from log attributes when context has no requestInfo", async () => {
            const context: ToolExecutionContext = {
                signal: new AbortController().signal,
            };

            await tool["connectToCluster"]("mongodb://localhost", ATLAS_INFO, context);

            for (const [payload] of (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls) {
                expect((payload as { attributes?: Record<string, string> }).attributes).not.toHaveProperty(
                    "x-request-id"
                );
            }
        });
    });
});
