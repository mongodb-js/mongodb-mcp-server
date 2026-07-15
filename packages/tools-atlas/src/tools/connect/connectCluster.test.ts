import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams, ToolExecutionContext } from "@mongodb-js/mcp-core";
import { ConnectClusterTool } from "./connectCluster.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-types";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

const ATLAS_INFO: AtlasClusterConnectionInfo = {
    username: "user1",
    projectId: "proj1",
    clusterName: "cluster1",
    instanceType: "DEDICATED",
    expiryDate: new Date(),
};

describe("ConnectClusterTool", () => {
    let mockLogger: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<IAtlasSession>;
    let tool: ConnectClusterTool;
    let connectToCluster: (
        connectionString: string,
        atlas: AtlasClusterConnectionInfo,
        context: ToolExecutionContext
    ) => Promise<void>;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        };

        mockSession = {
            sessionId: "test-session",
            logger: mockLogger as unknown as ICompositeLogger,
            apiClient: {} as never,
            connectedAtlasCluster: ATLAS_INFO,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
            keychain: new Keychain(),
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
        };

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as IElicitation;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: ConnectClusterTool.toolName,
            category: "atlas",
            operationType: ConnectClusterTool.operationType,
            session: mockSession as IAtlasSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
        };

        tool = new ConnectClusterTool(params);
        connectToCluster = tool["connectToCluster"].bind(tool) as (
            connectionString: string,
            atlas: AtlasClusterConnectionInfo,
            context: ToolExecutionContext
        ) => Promise<void>;
    });

    describe("connectToCluster request ID logging", () => {
        it("includes x-request-id in attempt and success debug logs", async () => {
            const context: ToolExecutionContext = {
                signal: new AbortController().signal,
                requestInfo: { headers: { "x-request-id": "req-connect-abc" } },
            };

            await connectToCluster("mongodb://localhost", ATLAS_INFO, context);

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

            await connectToCluster("mongodb://localhost", ATLAS_INFO, context);

            for (const [payload] of (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls) {
                expect((payload as { attributes?: Record<string, string> }).attributes).not.toHaveProperty(
                    "x-request-id"
                );
            }
        });
    });
});
