import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import type { ToolExecutionContext } from "@mongodb-js/mcp-types";
import { ConnectClusterTool } from "./connectCluster.js";
import type { IAtlasSession, IAtlasConfig } from "../../atlasTool.js";
import type { ITelemetry, IElicitation, ICompositeLogger } from "@mongodb-js/mcp-types";
import { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import type { AtlasClusterConnectionInfo } from "@mongodb-js/mcp-types";
import {
    MCPConnectionStore,
    type ConnectionRegistry,
    DeviceId,
    FakeConnectionManager,
} from "@mongodb-js/mcp-tools-mongodb";
import type { ConnectionManager } from "@mongodb-js/mcp-tools-mongodb";
import { Keychain } from "@mongodb-js/mcp-core";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { UserConfigSchema, type UserConfig } from "@mongodb-js/mcp-cli";

const defaultTestConfig: UserConfig = {
    ...UserConfigSchema.parse({}),
    telemetry: "disabled",
    loggers: ["stderr"],
};

const ATLAS_INFO: AtlasClusterConnectionInfo = {
    username: "user1",
    projectId: "proj1",
    clusterName: "cluster1",
    instanceType: "DEDICATED",
    expiryDate: new Date(),
};

// A dedicated (M10) cluster description as returned by the Atlas API. Dedicated
// clusters skip the shared-tier alerts hook, keeping execute() free of extra
// API calls.
const CLUSTER_DESCRIPTION = {
    name: "cluster1",
    stateName: "IDLE",
    replicationSpecs: [
        {
            regionConfigs: [{ providerName: "AWS", regionName: "US_EAST_1", electableSpecs: { instanceSize: "M10" } }],
        },
    ],
    connectionStrings: { standardSrv: "mongodb+srv://cluster1.abcde.mongodb.net" },
};

describe("ConnectClusterTool", () => {
    let mockLogger: Record<string, ReturnType<typeof vi.fn>>;
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockSession: Partial<IAtlasSession>;
    let connectionRegistry: ConnectionRegistry;
    let tool: ConnectClusterTool;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        };

        mockApiClient = {
            getCluster: vi.fn().mockResolvedValue(CLUSTER_DESCRIPTION),
            createDatabaseUser: vi.fn().mockResolvedValue({}),
            getGroup: vi.fn().mockResolvedValue({ name: "Test Project" }),
        };

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

        mockSession = {
            logger: mockLogger as unknown as ICompositeLogger,
            apiClient: { ...mockApiClient, logger: mockLogger } as unknown as ApiClient,
            connectionRegistry,
            keychain: new Keychain(),
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
                atlasTemporaryDatabaseUserLifetimeMs: 14_400_000,
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
            uiRegistry: new UIRegistry(),
        };

        tool = new ConnectClusterTool(params);
    });

    describe("execute", () => {
        const args = { projectId: "proj1", clusterName: "cluster1", connectionType: "standard" as const };

        it("names the entry combining the project and cluster names", async () => {
            const result = await tool["execute"](args, { signal: new AbortController().signal });

            expect(mockApiClient.getGroup).toHaveBeenCalledWith(
                { params: { path: { groupId: "proj1" } } },
                expect.anything()
            );
            expect(result.structuredContent?.state).toBe("connected");
            const connectionId = result.structuredContent?.connectionId;
            const entry = await connectionRegistry.peek(connectionId);
            expect(entry?.name).toMatch(/^test-project-cluster1-[0-9a-f]{4}$/);
        });

        it("falls back to the cluster name alone when the project lookup fails", async () => {
            mockApiClient.getGroup?.mockRejectedValue(new Error("forbidden"));

            const result = await tool["execute"](args, { signal: new AbortController().signal });

            expect(result.structuredContent?.state).toBe("connected");
            const connectionId = result.structuredContent?.connectionId;
            const entry = await connectionRegistry.peek(connectionId);
            expect(entry?.name).toMatch(/^cluster1-[0-9a-f]{4}$/);
        });

        it("reuses the existing entry when called again for the same cluster", async () => {
            const first = await tool["execute"](args, { signal: new AbortController().signal });
            const second = await tool["execute"](args, { signal: new AbortController().signal });

            expect(second.structuredContent?.connectionId).toBe(first.structuredContent?.connectionId);
            expect(first.structuredContent?.createdTemporaryUser).toBe(true);
            expect(second.structuredContent?.createdTemporaryUser).toBe(false);
            // The repeat call must not provision another temporary user.
            expect(mockApiClient.createDatabaseUser).toHaveBeenCalledTimes(1);
            await expect(connectionRegistry.find(() => true)).resolves.toHaveLength(1);
        });

        it("creates a separate entry for a different cluster", async () => {
            const first = await tool["execute"](args, { signal: new AbortController().signal });
            mockApiClient.getCluster?.mockResolvedValue({ ...CLUSTER_DESCRIPTION, name: "cluster2" });
            const second = await tool["execute"](
                { ...args, clusterName: "cluster2" },
                { signal: new AbortController().signal }
            );

            expect(second.structuredContent?.connectionId).not.toBe(first.structuredContent?.connectionId);
            expect(mockApiClient.createDatabaseUser).toHaveBeenCalledTimes(2);
        });
    });

    describe("connectToCluster request ID logging", () => {
        it("includes x-request-id in attempt and success debug logs", async () => {
            const context: ToolExecutionContext = {
                signal: new AbortController().signal,
                requestInfo: { headers: { "x-request-id": "req-connect-abc" } },
            };

            const entry = await connectionRegistry.createEntry({ name: ATLAS_INFO.clusterName });
            await tool["connectToCluster"](entry, "mongodb://localhost", ATLAS_INFO, context);

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

            const entry = await connectionRegistry.createEntry({ name: ATLAS_INFO.clusterName });
            await tool["connectToCluster"](entry, "mongodb://localhost", ATLAS_INFO, context);

            for (const [payload] of (mockLogger.debug as ReturnType<typeof vi.fn>).mock.calls) {
                expect((payload as { attributes?: Record<string, string> }).attributes).not.toHaveProperty(
                    "x-request-id"
                );
            }
        });
    });
});
