import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import {
    CompositeLogger,
    Elicitation,
    InMemoryTransport,
    Keychain,
    McpServer,
    NoopMetrics,
    NoopTelemetry,
} from "@mongodb-js/mcp-core";
import { ApiClient, ApiClientError, type FlexClusterDescription20241113 } from "@mongodb-js/mcp-atlas-api-client";
import { UpgradeClusterTool, type AtlasToolServer } from "@mongodb-js/mcp-tools-atlas";
import { UserConfigSchema } from "@mongodb-js/mcp-cli";
import { DeviceId, MCPConnectionStore } from "@mongodb-js/mcp-tools-mongodb";
import type { ITelemetry } from "@mongodb-js/mcp-types";

const PROJECT_ID = "507f1f77bcf86cd799439011";
const CLUSTER_NAME = "upgrade-cluster";
const unexpectedFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected Atlas HTTP request"));
const CLUSTER_DEFAULTS = {
    backupEnabled: false,
    configServerManagementMode: "ATLAS_MANAGED",
    diskWarmingMode: "FULLY_WARMED",
    replicaSetScalingStrategy: "WORKLOAD_TYPE",
    retainBackups: false,
    rootCertType: "ISRGROOTX1",
    terminationProtectionEnabled: false,
    useAwsTimeBasedSnapshotCopyForFastInitialSync: false,
    versionReleaseSystem: "LTS",
} as const;
const FLEX_CLUSTER: FlexClusterDescription20241113 = {
    id: "upgraded-cluster-id",
    clusterType: "REPLICASET",
    providerSettings: { providerName: "FLEX", backingProviderName: "AWS", regionName: "US_EAST_1" },
    terminationProtectionEnabled: false,
    versionReleaseSystem: "LTS",
};

describe("mocked atlas-upgrade-cluster autoscaling reporting", () => {
    const logger = new CompositeLogger();
    const apiClient = new ApiClient({
        options: {
            baseUrl: "https://atlas.invalid",
            userAgent: "test-server",
            httpClient: { fetch: unexpectedFetch, Request },
        },
        logger,
    });
    const mcpServer = new McpServer({ name: "test-server", version: "1.0" });
    const client = new Client({ name: "test-client", version: "1.0" });
    const telemetry: ITelemetry = new NoopTelemetry();
    let deviceId: DeviceId;
    let upgradeTenantUpgrade: MockInstance<ApiClient["upgradeTenantUpgrade"]>;
    let tenantUpgrade: MockInstance<ApiClient["tenantUpgrade"]>;
    let emitEvents: MockInstance<ITelemetry["emitEvents"]>;

    beforeAll(async () => {
        const config = UserConfigSchema.parse({
            apiClientId: "test-client",
            apiClientSecret: "test-secret",
            confirmationRequiredTools: [],
            connectionIdleTimeoutMs: 0,
        });
        const keychain = new Keychain();
        deviceId = DeviceId.create(logger);
        const connectionRegistry = new MCPConnectionStore({ options: config, logger, deviceId, keychain }).view();
        const tools: UpgradeClusterTool[] = [];
        const server: AtlasToolServer = {
            config,
            logger,
            keychain,
            apiClient,
            connectionRegistry,
            telemetry,
            elicitation: new Elicitation({ server: mcpServer.server }),
            metrics: new NoopMetrics(),
            mcpServer,
            tools,
            isToolCategoryAvailable: (category) => category === "atlas",
        };
        const tool = new UpgradeClusterTool({ server });
        tools.push(tool);
        expect(tool.register()).toBe(true);

        const clientTransport = new InMemoryTransport();
        const serverTransport = new InMemoryTransport();
        await clientTransport.start();
        await serverTransport.start();
        void clientTransport.output.pipeTo(serverTransport.input);
        void serverTransport.output.pipeTo(clientTransport.input);
        await mcpServer.connect(serverTransport);
        await client.connect(clientTransport);
    });

    afterAll(async () => {
        await client.close();
        await mcpServer.close();
        await apiClient.close();
        deviceId?.close();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe.each(["FREE", "FLEX"] as const)("%s to M10", (sourceTier) => {
        beforeEach(() => {
            vi.spyOn(telemetry, "isTelemetryEnabled").mockReturnValue(true);
            emitEvents = vi.spyOn(telemetry, "emitEvents");
            const getCluster = vi.spyOn(apiClient, "getCluster");
            const getFlexCluster = vi.spyOn(apiClient, "getFlexCluster");
            if (sourceTier === "FREE") {
                getCluster.mockResolvedValue({
                    ...CLUSTER_DEFAULTS,
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
                });
            } else {
                getCluster.mockRejectedValue(
                    ApiClientError.fromError({
                        response: new Response(null, { status: 404 }),
                        error: "cluster not found",
                    })
                );
                getFlexCluster.mockResolvedValue(FLEX_CLUSTER);
            }
            upgradeTenantUpgrade = vi.spyOn(apiClient, "upgradeTenantUpgrade").mockResolvedValue({
                ...CLUSTER_DEFAULTS,
                id: "upgraded-cluster-id",
                numShards: 1,
                replicationFactor: 3,
            });
            tenantUpgrade = vi.spyOn(apiClient, "tenantUpgrade").mockResolvedValue(FLEX_CLUSTER);
        });

        it.each([
            { args: {}, enabled: true, min: "M10", max: "M30" },
            { args: { computeAutoScaling: true }, enabled: true, min: "M10", max: "M30" },
            { args: { computeAutoScaling: false }, enabled: false, min: undefined, max: undefined },
            { args: { minInstanceSize: "M10", maxInstanceSize: "M40" }, enabled: true, min: "M10", max: "M40" },
            {
                args: { computeAutoScaling: false, minInstanceSize: "M10", maxInstanceSize: "M40" },
                enabled: false,
                min: sourceTier === "FLEX" ? "M10" : undefined,
                max: sourceTier === "FLEX" ? "M40" : undefined,
            },
        ])("returns the settings sent to Atlas for $args", async ({ args, enabled, min, max }) => {
            const response = await client.callTool({
                name: "atlas-upgrade-cluster",
                arguments: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, targetTier: "M10", ...args },
            });

            expect(response.isError).toBeFalsy();
            const text = response.content
                .flatMap((content) => (content.type === "text" ? [content.text] : []))
                .join("\n");
            if (Object.keys(args).length === 0) {
                expect(text).not.toContain("compute autoscaling");
            } else {
                expect(text).toContain(
                    enabled ? `compute autoscaling enabled (${min}-${max})` : "compute autoscaling disabled"
                );
            }
            expect(response.structuredContent).toEqual({
                originalTier: sourceTier,
                targetTier: "M10",
                computeAutoScaling: enabled,
                ...(min !== undefined && { minInstanceSize: min }),
                ...(max !== undefined && { maxInstanceSize: max }),
                resolvedProvider: "AWS",
                resolvedRegion: "US_EAST_1",
                clusterId: "upgraded-cluster-id",
            });

            if (sourceTier === "FREE") {
                expect(upgradeTenantUpgrade).toHaveBeenCalledOnce();
                expect(upgradeTenantUpgrade.mock.calls[0]?.[0].body).toEqual({
                    name: CLUSTER_NAME,
                    autoScaling: { compute: { enabled, scaleDownEnabled: enabled }, diskGBEnabled: true },
                    providerSettings: {
                        providerName: "AWS",
                        instanceSizeName: "M10",
                        regionName: "US_EAST_1",
                        ...(enabled && {
                            autoScaling: { compute: { minInstanceSize: min, maxInstanceSize: max } },
                        }),
                    },
                });
                expect(tenantUpgrade).not.toHaveBeenCalled();
            } else {
                expect(tenantUpgrade).toHaveBeenCalledOnce();
                expect(tenantUpgrade.mock.calls[0]?.[0].body).toEqual({
                    name: CLUSTER_NAME,
                    clusterType: "REPLICASET",
                    replicationSpecs: [
                        {
                            regionConfigs: [
                                {
                                    providerName: "AWS",
                                    regionName: "US_EAST_1",
                                    priority: 7,
                                    electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                                    autoScaling: {
                                        compute: {
                                            enabled,
                                            scaleDownEnabled: enabled,
                                            minInstanceSize: min,
                                            maxInstanceSize: max,
                                        },
                                        diskGB: { enabled: true },
                                    },
                                },
                            ],
                        },
                    ],
                });
                expect(upgradeTenantUpgrade).not.toHaveBeenCalled();
            }
            expect(emitEvents.mock.calls[0]?.[0][0]).toMatchObject({
                properties: {
                    command: "atlas-upgrade-cluster",
                    compute_auto_scaling: enabled ? "true" : "false",
                    min_instance_size: min?.toLowerCase(),
                    max_instance_size: max?.toLowerCase(),
                },
            });
            expect(unexpectedFetch).not.toHaveBeenCalled();
        });
    });
});
