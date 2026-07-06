import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolConstructorParams } from "@mongodb-js/mcp-core";
import { InspectClusterTool } from "./inspectCluster.js";
import type { ISession } from "@mongodb-js/mcp-types";
import type { ITelemetry } from "@mongodb-js/mcp-types";
import type { Elicitation } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "@mongodb-js/mcp-core";
import type { ApiClient } from "@mongodb-js/mcp-atlas-api-client";
import { UIRegistry } from "@mongodb-js/mcp-ui";
import { MockMetrics } from "@mongodb-js/mcp-test-utils";

const freeClusterApiResponse = {
    name: "my-cluster",
    paused: false,
    stateName: "IDLE",
    mongoDBVersion: "7.0",
    connectionStrings: { standard: "mongodb://host" },
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "TENANT",
                    backingProviderName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M0" },
                },
            ],
        },
    ],
};

const dedicatedClusterApiResponse = {
    name: "my-cluster",
    paused: false,
    stateName: "IDLE",
    mongoDBVersion: "8.0",
    connectionStrings: { standardSrv: "mongodb+srv://host" },
    replicationSpecs: [
        {
            regionConfigs: [
                {
                    providerName: "AWS",
                    regionName: "US_EAST_1",
                    electableSpecs: { instanceSize: "M10" },
                },
            ],
        },
    ],
};

describe("InspectClusterTool", () => {
    let mockApiClient: Record<string, ReturnType<typeof vi.fn>>;
    let mockLogger: CompositeLogger;
    let tool: InspectClusterTool;

    beforeEach(() => {
        mockApiClient = {
            getCluster: vi.fn(),
            getFlexCluster: vi.fn(),
        };

        mockLogger = {
            info: vi.fn(),
            debug: vi.fn(),
            warning: vi.fn(),
            error: vi.fn(),
        } as unknown as CompositeLogger;

        const mockSession = {
            logger: mockLogger,
            apiClient: { ...mockApiClient, logger: mockLogger } as unknown as ApiClient,
        } as unknown as ISession;

        const mockTelemetry = {
            isTelemetryEnabled: () => true,
            emitEvents: vi.fn(),
        } as unknown as ITelemetry;

        const mockElicitation = {
            requestConfirmation: vi.fn(),
        } as unknown as Elicitation;

        const params: ToolConstructorParams = {
            name: InspectClusterTool.toolName,
            category: "atlas",
            operationType: InspectClusterTool.operationType,
            session: mockSession,
            telemetry: mockTelemetry,
            elicitation: mockElicitation,
            metrics: new MockMetrics(),
            uiRegistry: new UIRegistry(),
        };

        tool = new InspectClusterTool(params);
    });

    const baseArgs = { projectId: "507f1f77bcf86cd799439011", clusterName: "my-cluster" };
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    const exec = (args: Record<string, unknown>) =>
        tool["execute"](args as never, { signal: new AbortController().signal } as never);

    it("returns cluster details when getCluster succeeds", async () => {
        mockApiClient.getCluster!.mockResolvedValue(freeClusterApiResponse);

        const result = await exec({ ...baseArgs });

        const text = result.content.map((c) => (c as { text: string }).text).join("\n");
        expect(text).toContain("Cluster details:");
        expect(text).toContain("my-cluster");
        expect(text).toContain("<untrusted-user-data-");
    });

    it("passes projectId and clusterName to getCluster", async () => {
        mockApiClient.getCluster!.mockResolvedValue(freeClusterApiResponse);

        await exec({ ...baseArgs });

        expect(mockApiClient.getCluster).toHaveBeenCalledWith(
            {
                params: {
                    path: {
                        groupId: baseArgs.projectId,
                        clusterName: baseArgs.clusterName,
                    },
                },
            },
            expect.anything()
        );
        expect(mockApiClient.getFlexCluster).not.toHaveBeenCalled();
    });

    it("falls back to getFlexCluster when getCluster fails", async () => {
        mockApiClient.getCluster!.mockRejectedValue(new Error("not a dedicated cluster"));
        mockApiClient.getFlexCluster!.mockResolvedValue({
            name: "flex-cluster",
            stateName: "IDLE",
            mongoDBVersion: "8.0",
            connectionStrings: { standardSrv: "mongodb+srv://flex" },
            providerSettings: {
                backingProviderName: "AWS",
                regionName: "US_EAST_1",
            },
        });

        const result = await exec({ ...baseArgs, clusterName: "flex-cluster" });

        expect(mockApiClient.getFlexCluster).toHaveBeenCalledWith(
            {
                params: {
                    path: {
                        groupId: baseArgs.projectId,
                        name: "flex-cluster",
                    },
                },
            },
            expect.anything()
        );
        expect(result.structuredContent).toMatchObject({
            name: "flex-cluster",
            instanceType: "FLEX",
            instanceSize: "N/A",
            provider: "AWS",
            region: "US_EAST_1",
        });
    });

    it("applies default values for missing cluster fields", async () => {
        mockApiClient.getCluster!.mockResolvedValue({
            paused: true,
            replicationSpecs: [
                {
                    regionConfigs: [
                        {
                            providerName: "AWS",
                            electableSpecs: { instanceSize: "M10" },
                        },
                    ],
                },
            ],
        });

        const result = await exec({ ...baseArgs });

        expect(result.structuredContent).toEqual({
            name: "Unknown",
            instanceType: "DEDICATED",
            instanceSize: "M10",
            provider: "AWS",
            region: undefined,
            paused: true,
            state: "UNKNOWN",
            mongoDBVersion: "N/A",
            connectionStrings: {},
        });
    });

    describe("structuredContent", () => {
        it("returns formatted cluster metadata on success", async () => {
            mockApiClient.getCluster!.mockResolvedValue(dedicatedClusterApiResponse);

            const result = await exec({ ...baseArgs });

            expect(result.structuredContent).toEqual({
                name: "my-cluster",
                instanceType: "DEDICATED",
                instanceSize: "M10",
                provider: "AWS",
                region: "US_EAST_1",
                paused: false,
                state: "IDLE",
                mongoDBVersion: "8.0",
                connectionStrings: { standardSrv: "mongodb+srv://host" },
            });
        });

        it("maps FREE cluster instanceSize to N/A", async () => {
            mockApiClient.getCluster!.mockResolvedValue({
                ...freeClusterApiResponse,
                name: "free-cluster",
            });

            const result = await exec({ ...baseArgs, clusterName: "free-cluster" });

            expect(result.structuredContent).toMatchObject({
                name: "free-cluster",
                instanceType: "FREE",
                instanceSize: "N/A",
            });
        });

        it("omits structuredContent on error paths", async () => {
            mockApiClient.getCluster!.mockRejectedValue(new Error("cluster not found"));
            mockApiClient.getFlexCluster!.mockRejectedValue(new Error("flex cluster not found"));

            await expect(exec({ ...baseArgs })).rejects.toThrow("cluster not found");
        });
    });
});
