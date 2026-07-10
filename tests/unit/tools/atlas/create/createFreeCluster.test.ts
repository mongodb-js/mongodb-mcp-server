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
import { ApiClientError } from "../../../../../src/common/atlas/apiClientError.js";

describe("CreateFreeClusterTool", () => {
    let mockApiClient: {
        supportsCurrentIpLookup: boolean;
        createCluster: ReturnType<typeof vi.fn>;
        getIpInfo: ReturnType<typeof vi.fn>;
        createAccessListEntry: ReturnType<typeof vi.fn>;
        logger: CompositeLogger;
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
        } as unknown as CompositeLogger;

        mockApiClient = {
            supportsCurrentIpLookup: true,
            createCluster: vi.fn().mockResolvedValue({}),
            getIpInfo: vi.fn().mockResolvedValue({ currentIpv4Address: "127.0.0.1" }),
            createAccessListEntry: vi.fn().mockResolvedValue({}),
            logger: mockLogger,
        };

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

    it("creates a free cluster and notes that the current IP was added to the access list", async () => {
        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain('Cluster "free-cluster" has been created in region "US_EAST_1"');
        expect(text).toContain("Your current IP address has been added");
        expect(result.structuredContent).toEqual({
            created: true,
        });
    });

    it("does not mention the access list when the current IP is already present", async () => {
        mockApiClient.createAccessListEntry.mockRejectedValue(
            ApiClientError.fromError(
                { status: 409, statusText: "Conflict" } as Response,
                { message: "Conflict" } as never
            )
        );

        const result = await exec();

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain('Cluster "free-cluster" has been created in region "US_EAST_1"');
        expect(text).not.toContain("access list");
    });

    it("skips the IP lookup and explains that no access list changes were made when current IP lookup is not supported", async () => {
        Object.assign(mockApiClient, { supportsCurrentIpLookup: false });

        const result = await exec();

        expect(mockApiClient.getIpInfo).not.toHaveBeenCalled();
        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain('Cluster "free-cluster" has been created in region "US_EAST_1"');
        expect(text).toContain("No IP access list changes were made");
        expect(text).toContain("cannot determine your public IP address");
        expect(text).not.toContain("Your current IP address has been added");
    });

    it("still creates the cluster and notes that no access list changes were made when the IP lookup fails", async () => {
        mockApiClient.getIpInfo.mockRejectedValue(new Error("ipinfo unavailable"));

        const result = await exec();

        expect(mockApiClient.createCluster).toHaveBeenCalledOnce();
        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("No IP access list changes were made");
        expect(text).toContain("did not succeed");
        expect(text).not.toContain("cannot determine your public IP address");
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
