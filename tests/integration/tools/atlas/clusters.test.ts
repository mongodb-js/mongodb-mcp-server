import { Session } from "../../../../src/session.js";
import { expectDefined } from "../../helpers.js";
import { describeWithAtlas, withProject, randomId } from "./atlasHelpers.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteAndWaitCluster(session: Session, projectId: string, clusterName: string) {
    await session.apiClient.deleteCluster({
        params: {
            path: {
                groupId: projectId,
                clusterName,
            },
        },
    });
    while (true) {
        try {
            await session.apiClient.getCluster({
                params: {
                    path: {
                        groupId: projectId,
                        clusterName,
                    },
                },
            });
            await sleep(1000);
        } catch {
            break;
        }
    }
}

async function waitClusterState(session: Session, projectId: string, clusterName: string, state: string) {
    while (true) {
        const cluster = await session.apiClient.getCluster({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        if (cluster?.stateName === state) {
            return;
        }
        await sleep(1000);
    }
}

describeWithAtlas("clusters", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        const clusterName = "ClusterTest-" + randomId;

        afterAll(async () => {
            const projectId = getProjectId();

            const session: Session = integration.mcpServer().session;

            await deleteAndWaitCluster(session, projectId, clusterName);
        });

        describe("atlas-create-free-cluster", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const createFreeCluster = tools.find((tool) => tool.name === "atlas-create-free-cluster");

                expectDefined(createFreeCluster);
                expect(createFreeCluster.inputSchema.type).toBe("object");
                expectDefined(createFreeCluster.inputSchema.properties);
                expect(createFreeCluster.inputSchema.properties).toHaveProperty("projectId");
                expect(createFreeCluster.inputSchema.properties).toHaveProperty("name");
                expect(createFreeCluster.inputSchema.properties).toHaveProperty("region");
            });

            it("should create a free cluster", async () => {
                const projectId = getProjectId();

                const response = (await integration.mcpClient().callTool({
                    name: "atlas-create-free-cluster",
                    arguments: {
                        projectId,
                        name: clusterName,
                        region: "US_EAST_1",
                    },
                })) as CallToolResult;
                expect(response.content).toBeArray();
                expect(response.content).toHaveLength(2);
                expect(response.content[0]?.text).toContain("has been created");
            });
        });

        describe("atlas-inspect-cluster", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const inspectCluster = tools.find((tool) => tool.name === "atlas-inspect-cluster");

                expectDefined(inspectCluster);
                expect(inspectCluster.inputSchema.type).toBe("object");
                expectDefined(inspectCluster.inputSchema.properties);
                expect(inspectCluster.inputSchema.properties).toHaveProperty("projectId");
                expect(inspectCluster.inputSchema.properties).toHaveProperty("clusterName");
            });

            it("returns cluster data", async () => {
                const projectId = getProjectId();

                const response = (await integration.mcpClient().callTool({
                    name: "atlas-inspect-cluster",
                    arguments: { projectId, clusterName: clusterName },
                })) as CallToolResult;
                expect(response.content).toBeArray();
                expect(response.content).toHaveLength(1);
                expect(response.content[0]?.text).toContain(`${clusterName} | `);
            });
        });

        describe("atlas-list-clusters", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const listClusters = tools.find((tool) => tool.name === "atlas-list-clusters");
                expectDefined(listClusters);
                expect(listClusters.inputSchema.type).toBe("object");
                expectDefined(listClusters.inputSchema.properties);
                expect(listClusters.inputSchema.properties).toHaveProperty("projectId");
            });

            it("returns clusters by project", async () => {
                const projectId = getProjectId();

                const response = (await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-clusters", arguments: { projectId } })) as CallToolResult;
                expect(response.content).toBeArray();
                expect(response.content).toHaveLength(2);
                expect(response.content[1]?.text).toContain(`${clusterName} | `);
            });
        });

        describe("atlas-connect-cluster", () => {
            beforeAll(async () => {
                const projectId = getProjectId();
                await waitClusterState(integration.mcpServer().session, projectId, clusterName, "IDLE");
                await integration.mcpServer().session.apiClient.createProjectIpAccessList({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                    body: [
                        {
                            comment: "MCP test",
                            cidrBlock: "0.0.0.0/0",
                        },
                    ],
                });
            });

            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const connectCluster = tools.find((tool) => tool.name === "atlas-connect-cluster");

                expectDefined(connectCluster);
                expect(connectCluster.inputSchema.type).toBe("object");
                expectDefined(connectCluster.inputSchema.properties);
                expect(connectCluster.inputSchema.properties).toHaveProperty("projectId");
                expect(connectCluster.inputSchema.properties).toHaveProperty("clusterName");
            });

            it("connects to cluster", async () => {
                const projectId = getProjectId();

                const response = (await integration.mcpClient().callTool({
                    name: "atlas-connect-cluster",
                    arguments: { projectId, clusterName },
                })) as CallToolResult;
                expect(response.content).toBeArray();
                expect(response.content).toHaveLength(1);
                expect(response.content[0]?.text).toContain(`Connected to cluster "${clusterName}"`);
            });
        });
    });
});
