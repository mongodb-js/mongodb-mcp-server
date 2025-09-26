// This test file includes long running tests (>10 minutes) because we provision a real M10 cluster, which can take up to 10 minutes to provision.
// The timeouts for the beforeAll/afterAll hooks have been modified to account for longer running tests.

import type { Session } from "../../../../src/common/session.js";
import { expectDefined, getResponseElements } from "../../helpers.js";
import { describeWithAtlas, withProject, randomId, deleteAndWaitCluster, waitCluster, sleep } from "./atlasHelpers.js";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

describeWithAtlas("performanceAdvisor", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        const clusterName = "ClusterTest-" + randomId;

        afterAll(async () => {
            const projectId = getProjectId();
            if (projectId) {
                const session: Session = integration.mcpServer().session;
                await deleteAndWaitCluster(session, projectId, clusterName, 1000, 1200);
            }
        }, 1200000);

        describe("atlas-get-performance-advisor", () => {
            beforeAll(async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;

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

                await sleep(10000);
            }, 1200000);

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

            it("returns mocked performance advisor data", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;

                // Mock the API client methods since we can't guarantee performance advisor data
                const mockSuggestedIndexes = vi.fn().mockResolvedValue({
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

                const mockDropIndexSuggestions = vi.fn().mockResolvedValue({
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

                const mockSchemaAdvice = vi.fn().mockResolvedValue({
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
                                                details:
                                                    "Queries filtering by status field are causing collection scans",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                });

                const mockSlowQueries = vi.fn().mockResolvedValue({
                    slowQueries: [
                        {
                            namespace: "testdb.testcollection",
                            query: { find: "testcollection", filter: { status: "active" } },
                            duration: 1500,
                            timestamp: "2024-01-15T10:30:00Z",
                        },
                    ],
                });

                const mockGetCluster = vi.fn().mockResolvedValue({
                    connectionStrings: {
                        standard: "mongodb://test-cluster.mongodb.net:27017",
                    },
                });

                session.apiClient.listClusterSuggestedIndexes = mockSuggestedIndexes;
                session.apiClient.listDropIndexes = mockDropIndexSuggestions;
                session.apiClient.listSchemaAdvice = mockSchemaAdvice;
                session.apiClient.listSlowQueries = mockSlowQueries;
                session.apiClient.getCluster = mockGetCluster;

                const response = await integration.mcpClient().callTool({
                    name: "atlas-get-performance-advisor",
                    arguments: {
                        projectId,
                        clusterName: "mockClusterName",
                        operations: ["suggestedIndexes", "dropIndexSuggestions", "slowQueryLogs", "schemaSuggestions"],
                    },
                });

                if (response.isError) {
                    console.error("Performance advisor call failed:", response.content);
                    throw new Error("Performance advisor call failed - see console for details");
                }

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
        });
    });
});
