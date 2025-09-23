import { expectDefined, getResponseElements } from "../../helpers.js";
import { describeWithAtlas, withProject } from "./atlasHelpers.js";
import { describe, expect, it, vi } from "vitest";

describeWithAtlas("performanceAdvisor", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        describe("atlas-get-performance-advisor", () => {
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

            it("returns performance advisor data with no recommendations", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;

                const mockSuggestedIndexes = vi.fn().mockResolvedValue({
                    content: {
                        suggestedIndexes: [],
                    },
                });

                const mockDropIndexSuggestions = vi.fn().mockResolvedValue({
                    content: {
                        hiddenIndexes: [],
                        redundantIndexes: [],
                        unusedIndexes: [],
                    },
                });

                const mockSchemaAdvice = vi.fn().mockResolvedValue({
                    content: {
                        recommendations: [],
                    },
                });

                const mockSlowQueries = vi.fn().mockResolvedValue({
                    slowQueries: [],
                });

                // Mock the cluster inspection for getProcessIdFromCluster
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
                expect(elements[1]?.text).toContain("No suggested indexes found.");
                expect(elements[1]?.text).toContain("## Drop Index Suggestions");
                expect(elements[1]?.text).toContain("No drop index suggestions found.");
                expect(elements[1]?.text).toContain("## Slow Query Logs");
                expect(elements[1]?.text).toContain("No slow query logs found.");
                expect(elements[1]?.text).toContain("## Schema Suggestions");
                expect(elements[1]?.text).toContain("No schema suggestions found.");

                expect(mockSuggestedIndexes).toHaveBeenCalled();
                expect(mockDropIndexSuggestions).toHaveBeenCalled();
                expect(mockSchemaAdvice).toHaveBeenCalled();
                expect(mockSlowQueries).toHaveBeenCalled();
                expect(mockGetCluster).toHaveBeenCalled();
            });
        });
    });
});
