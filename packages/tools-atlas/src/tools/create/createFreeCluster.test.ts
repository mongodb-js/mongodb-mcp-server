import { describe, it, expect, vi, beforeEach } from "vitest";
import { CreateFreeClusterTool } from "./createFreeCluster.js";
import type { ITelemetry, ICompositeLogger } from "@mongodb-js/mcp-types";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import { MockMetrics, createMockElicitation } from "@mongodb-js/mcp-test-utils";
import { Keychain } from "@mongodb-js/mcp-core";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import type { AtlasToolServer } from "../../atlasTool.js";
import type {} from "@mongodb-js/mcp-types";

describe("CreateFreeClusterTool", () => {
    let mockApiClient: {
        supportsCurrentIpLookup: boolean;
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
        } as unknown as ICompositeLogger;

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
            keychain: new Keychain(),
        } as unknown as AtlasToolServer;

        const server: AtlasToolServer = {
            ...mockSession,
            telemetry: { isTelemetryEnabled: () => false, emitEvents: vi.fn() } as unknown as ITelemetry,
            elicitation: createMockElicitation(),
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new CreateFreeClusterTool(server);
    });

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown> = baseArgs) =>
        tool["execute"](args as never, {
            request: {
                config: (tool as unknown as { server: AtlasToolServer }).server.config,
                signal: new AbortController().signal,
            },
        });

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
