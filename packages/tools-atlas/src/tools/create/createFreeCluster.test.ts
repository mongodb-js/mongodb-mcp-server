import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { CreateFreeClusterTool } from "./createFreeCluster.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics } from "../../mockMetrics.js";
import { Keychain } from "@mongodb-js/mcp-core";

describe("CreateFreeClusterTool", () => {
    let mockApiClient: {
        createCluster: ReturnType<typeof vi.fn>;
        getIpInfo: ReturnType<typeof vi.fn>;
        createAccessListEntry: ReturnType<typeof vi.fn>;
        logger: ICompositeLogger;
    };
    let tool: CreateFreeClusterTool;

    const baseArgs = {
        projectId: "507f1f77bcf86cd799439011",
        name: "free-cluster",
        region: "US_EAST_1",
    };

    beforeEach(() => {
        const mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
            setAttribute: vi.fn(),
            addLogger: vi.fn(),
        } as unknown as ICompositeLogger;

        mockApiClient = {
            createCluster: vi.fn().mockResolvedValue({}),
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" }),
            createAccessListEntry: vi.fn().mockResolvedValue({}),
            logger: mockLogger,
        };

        const mockSession = {
            sessionId: "test-session",
            logger: mockLogger,
            apiClient: mockApiClient as unknown as ApiClient,
            connectedAtlasCluster: undefined,
            connectToMongoDB: vi.fn().mockResolvedValue(undefined),
            keychain: new Keychain(),
            config: {
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as IAtlasConfig,
            disconnect: vi.fn().mockResolvedValue(undefined),
            close: vi.fn().mockResolvedValue(undefined),
            isConnectedToMongoDB: false,
            on: vi.fn(),
            setMcpClient: vi.fn(),
        } as unknown as IAtlasSession;

        const params: ToolConstructorParams<IAtlasSession> = {
            name: CreateFreeClusterTool.toolName,
            category: "atlas",
            operationType: CreateFreeClusterTool.operationType,
            session: mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as IElicitation,
            metrics: new MockMetrics(),
        };

        tool = new CreateFreeClusterTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = baseArgs) => tool["execute"](args as never);

    it("creates a free cluster and returns success content", async () => {
        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain('Cluster "free-cluster" has been created in region "US_EAST_1"');
        expect(text).toContain("Double check your access lists");
    });

    it("calls createCluster with M0 replication specs", async () => {
        await exec();

        expect(mockApiClient.createCluster).toHaveBeenCalledOnce();
        const call = mockApiClient.createCluster?.mock.calls[0]?.[0] as { body: Record<string, unknown> };
        expect(call.body).toMatchObject({
            name: "free-cluster",
            clusterType: "REPLICASET",
            replicationSpecs: [
                expect.objectContaining({
                    regionConfigs: [
                        expect.objectContaining({
                            electableSpecs: { instanceSize: "M0" },
                        }),
                    ],
                }),
            ],
        });
    });
});
