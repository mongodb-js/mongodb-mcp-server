import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "../../../../../src/tools/tool.js";
import { CreateFreeClusterTool } from "../../../../../src/tools/atlas/create/createFreeCluster.js";
import type { Session } from "../../../../../src/common/session.js";
import type { UserConfig } from "../../../../../src/common/config/userConfig.js";
import type { Telemetry } from "../../../../../src/telemetry/telemetry.js";
import type { Elicitation } from "../../../../../src/elicitation.js";
import type { CompositeLogger } from "../../../../../src/common/logging/index.js";
import type { ApiClient } from "../../../../../src/common/atlas/apiClient.js";
import { UIRegistry } from "../../../../../src/ui/registry/index.js";
import { MockMetrics } from "../../../mocks/metrics.js";

describe("CreateFreeClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let tool: CreateFreeClusterTool;

    const baseArgs = {
        projectId: "507f1f77bcf86cd799439011",
        name: "free-cluster",
        region: "US_EAST_1",
    };

    beforeEach(() => {
        mockApiClient = {
            createCluster: vi.fn().mockResolvedValue({}),
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" }),
            createAccessListEntry: vi.fn().mockResolvedValue({}),
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

        const params: ToolConstructorParams = {
            name: CreateFreeClusterTool.toolName,
            category: "atlas",
            operationType: CreateFreeClusterTool.operationType,
            session: mockSession,
            config: {
                confirmationRequiredTools: [],
                previewFeatures: [],
                disabledTools: [],
                apiClientId: "test-id",
                apiClientSecret: "test-secret",
            } as unknown as UserConfig,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as Telemetry,
            elicitation: { requestConfirmation: vi.fn() } as unknown as Elicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateFreeClusterTool(params);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = baseArgs) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

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
            name: baseArgs.name,
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

    describe("structuredContent", () => {
        it("returns cluster metadata on success", async () => {
            const result = await exec();

            expect(result.structuredContent).toEqual({
                name: baseArgs.name,
                region: baseArgs.region,
            });
        });
    });
});
