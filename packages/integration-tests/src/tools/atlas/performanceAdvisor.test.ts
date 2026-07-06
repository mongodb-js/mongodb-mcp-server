// This test file includes long running tests (>10 minutes) because we provision a real M10 cluster, which can take up to 10 minutes to provision.
// The timeouts for the beforeAll/afterAll hooks have been modified to account for longer running tests.

import { ObjectId } from "bson";
import type { Session } from "../../../../src/common/session.js";
import {
    DEFAULT_LONG_RUNNING_TEST_WAIT_TIMEOUT_MS,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
} from "../../helpers.js";
import {
    describeWithAtlas,
    withProject,
    randomId,
    waitCluster,
    deleteCluster,
    assertApiClientIsAvailable,
} from "./atlasHelpers.js";
import type { Mock, MockInstance } from "vitest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseEvent, ToolEvent } from "../../../../src/telemetry/types.js";

describeWithAtlas("performanceAdvisor", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        const clusterName = "ClusterTest-" + randomId();

        afterAll(async () => {
            const projectId = getProjectId();
            if (projectId) {
                const session: Session = integration.mcpServer().session;
                await deleteCluster(session, projectId, clusterName);
            }
        }, DEFAULT_LONG_RUNNING_TEST_WAIT_TIMEOUT_MS);

        describe("atlas-get-performance-advisor", () => {
            beforeAll(async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                await session.apiClient.createCluster({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                    body: {
                        name: clusterName,
                        clusterType: "REPLICASET",
                        backupEnabled: true,
                        configServerManagementMode: "ATLAS_MANAGED",
                        diskWarmingMode: "FULLY_WARMED",
                        replicaSetScalingStrategy: "WORKLOAD_TYPE",
                        rootCertType: "ISRGROOTX1",
                        terminationProtectionEnabled: false,
                        versionReleaseSystem: "LTS",
                        useAwsTimeBasedSnapshotCopyForFastInitialSync: false,
                        replicationSpecs: [
                            {
                                zoneName: "Zone 1",
                                regionConfigs: [
                                    {
                                        providerName: "AWS",
                                        regionName: "US_EAST_1",
                                        electableSpecs: { instanceSize: "M10", nodeCount: 3 },
                                        priority: 7,
                                    },
                                ],
                            },
                        ],
                        retainBackups: false,
                    },
                });

                await waitCluster(
                    session,
                    projectId,
                    clusterName,
                    (cluster) => {
                        return cluster.stateName === "IDLE";
                    },
                    10000,
                    120
                );
            }, DEFAULT_LONG_RUNNING_TEST_WAIT_TIMEOUT_MS);

            afterEach(() => {
                vi.clearAllMocks();
            });

            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const getPerformanceAdvisor = tools.find((tool) => tool.name === "atlas-get-performance-advisor");
                expectDefined(getPerformanceAdvisor);
                expect(getPerformanceAdvisor.inputSchema.type).toBe("object");
                expectDefined(getPerformanceAdvisor.inputSchema.properties);
                expect(getPerformanceAdvisor.inputSchema.properties).toHaveProperty("projectId");
                expect(getPerformanceAdvisor.inputSchema.properties).toHaveProperty("clusterName");
                expect(getPerformanceAdvisor.inputSchema.properties).toHaveProperty("operations");
                expect(getPerformanceAdvisor.inputSchema.properties).toHaveProperty("since");
                expect(getPerformanceAdvisor.inputSchema.properties).toHaveProperty("namespaces");
            });

            it("returns performance advisor data from a paid tier cluster", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                await session.apiClient.getCluster({
                    params: {
                        path: {
                            groupId: projectId,
                            clusterName,
                        },
                    },
                });

                const response = await integration.mcpClient().callTool({
                    name: "atlas-get-performance-advisor",
                    arguments: {
                        projectId,
                        clusterName,
                        operations: ["suggestedIndexes", "dropIndexSuggestions", "schemaSuggestions"],
                    },
                });

                const elements = getResponseElements(response.content);
                expect(elements).toHaveLength(2);

                expect(elements[0]?.text).toContain("Performance advisor data");
                expect(elements[1]?.text).toContain("<untrusted-user-data-");

                expect(elements[1]?.text).toContain("## Suggested Indexes");
                expect(elements[1]?.text).toContain("## Drop Index Suggestions");
                expect(elements[1]?.text).toContain("## Schema Suggestions");
            });
        });
    });
});

describe("mocked atlas-get-performance-advisor", () => {
    const integration = setupIntegrationTest(() => ({
        ...defaultTestConfig,
        apiClientId: process.env.MDB_MCP_API_CLIENT_ID || "test-client",
        apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "test-secret",
        apiBaseUrl: process.env.MDB_MCP_API_BASE_URL ?? "https://cloud-dev.mongodb.com",
    }));

    let mockEmitEvents: MockInstance<(events: BaseEvent[]) => void>;
    let projectId: string;

    let mockSuggestedIndexes: Mock;
    let mockDropIndexSuggestions: Mock;
    let mockSchemaAdvice: Mock;
    let mockSlowQueries: Mock;
    let mockGetCluster: Mock;

    beforeEach(() => {
        mockEmitEvents = vi.spyOn(integration.mcpServer()["telemetry"], "emitEvents");
        vi.spyOn(integration.mcpServer()["telemetry"], "isTelemetryEnabled").mockReturnValue(true);

        projectId = new ObjectId().toString();

        const session = integration.mcpServer().session;

        // Mock the API client methods since we can't guarantee performance advisor data
        mockSuggestedIndexes = vi.fn().mockResolvedValue({
            content: {
                suggestedIndexes: [
                    {
                        namespace: "testdb.testcollection",
                        index: { field: 1 },
                        impact: ["queryShapeString"],
                    },
                ],
            },
        });

        mockDropIndexSuggestions = vi.fn().mockResolvedValue({
            content: {
                hiddenIndexes: [],
                redundantIndexes: [
                    {
                        accessCount: 100,
                        namespace: "testdb.testcollection",
                        index: { field: 1 },
                        reason: "Redundant with compound index",
                    },
                ],
                unusedIndexes: [],
            },
        });

        mockSchemaAdvice = vi.fn().mockResolvedValue({
            content: {
                recommendations: [
                    {
                        description: "Consider adding an index on 'status' field",
                        recommendation: "REDUCE_LOOKUP_OPS",
                        affectedNamespaces: [
                            {
                                namespace: "testdb.testcollection",
                                triggers: [
                                    {
                                        triggerType: "PERCENT_QUERIES_USE_LOOKUP",
                                        details: "Queries filtering by status field are causing collection scans",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
        });

        mockSlowQueries = vi.fn().mockResolvedValue({
            slowQueries: [
                {
                    namespace: "testdb.testcollection",
                    query: { find: "testcollection", filter: { status: "active" } },
                    duration: 1500,
                    timestamp: "2024-01-15T10:30:00Z",
                },
            ],
        });

        mockGetCluster = vi.fn().mockResolvedValue({
            connectionStrings: {
                standard: "mongodb://test-cluster.mongodb.net:27017",
            },
        });
        assertApiClientIsAvailable(session);
        session.apiClient.listClusterSuggestedIndexes = mockSuggestedIndexes;
        session.apiClient.listDropIndexSuggestions = mockDropIndexSuggestions;
        session.apiClient.listSchemaAdvice = mockSchemaAdvice;
        session.apiClient.listSlowQueryLogs = mockSlowQueries;
        session.apiClient.getCluster = mockGetCluster;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("returns mocked performance advisor data", async () => {
        const response = await integration.mcpClient().callTool({
            name: "atlas-get-performance-advisor",
            arguments: {
                projectId,
                clusterName: "mockClusterName",
                operations: ["suggestedIndexes", "dropIndexSuggestions", "slowQueryLogs", "schemaSuggestions"],
            },
        });

        expect(response.isError).toBeUndefined();

        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(2);

        expect(elements[0]?.text).toContain("Performance advisor data");
        expect(elements[1]?.text).toContain("<untrusted-user-data-");

        expect(elements[1]?.text).toContain("## Suggested Indexes");
        expect(elements[1]?.text).toContain("## Drop Index Suggestions");
        expect(elements[1]?.text).toContain("## Slow Query Logs");
        expect(elements[1]?.text).toContain("## Schema Suggestions");

        expect(mockSuggestedIndexes).toHaveBeenCalled();
        expect(mockDropIndexSuggestions).toHaveBeenCalled();
        expect(mockSchemaAdvice).toHaveBeenCalled();
        expect(mockSlowQueries).toHaveBeenCalled();
        expect(mockGetCluster).toHaveBeenCalled();
    });

    it("emits operations when not supplied", async () => {
        await integration.mcpClient().callTool({
            name: "atlas-get-performance-advisor",
            arguments: {
                projectId,
                clusterName: "mockClusterName",
            },
        });

        expect(mockEmitEvents).toHaveBeenCalled();
        const emittedEvent = mockEmitEvents.mock.lastCall?.[0][0] as ToolEvent;
        expectDefined(emittedEvent);
        expect(emittedEvent.properties.result).toEqual("success");
        expect(emittedEvent.properties.command).toEqual("atlas-get-performance-advisor");
        expect(emittedEvent.properties.operations).toEqual([
            "suggestedIndexes",
            "dropIndexSuggestions",
            "slowQueryLogs",
            "schemaSuggestions",
        ]);
    });

    it("emits operations when supplied", async () => {
        await integration.mcpClient().callTool({
            name: "atlas-get-performance-advisor",
            arguments: {
                projectId,
                clusterName: "mockClusterName",
                operations: ["suggestedIndexes", "slowQueryLogs"],
            },
        });

        expect(mockEmitEvents).toHaveBeenCalled();
        const emittedEvent = mockEmitEvents.mock.lastCall?.[0][0] as ToolEvent;
        expectDefined(emittedEvent);
        expect(emittedEvent.properties.result).toEqual("success");
        expect(emittedEvent.properties.command).toEqual("atlas-get-performance-advisor");
        expect(emittedEvent.properties.operations).toEqual(["suggestedIndexes", "slowQueryLogs"]);
    });
});
