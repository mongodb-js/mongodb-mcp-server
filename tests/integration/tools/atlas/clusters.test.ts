import { Session } from "../../../../src/common/session.js";
import { expectDefined, getResponseElements } from "../../helpers.js";
import { describeWithAtlas, withProject, randomId } from "./atlasHelpers.js";
import { ClusterDescription20240805 } from "../../../../src/common/atlas/openapi.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteAndWaitCluster(session: Session, projectId: string, clusterName: string): Promise<void> {
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

async function waitCluster(
    session: Session,
    projectId: string,
    clusterName: string,
    check: (cluster: ClusterDescription20240805) => boolean | Promise<boolean>
): Promise<void> {
    while (true) {
        const cluster = await session.apiClient.getCluster({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        if (await check(cluster)) {
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

            it("should create a free cluster and add current IP to access list", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;
                const ipInfo = await session.apiClient.getIpInfo();

                const response = (await integration.mcpClient().callTool({
                    name: "atlas-create-free-cluster",
                    arguments: {
                        projectId,
                        name: clusterName,
                        region: "US_EAST_1",
                    },
                })) as CallToolResult;
                expect(response.content).toBeInstanceOf(Array);
                expect(response.content).toHaveLength(2);
                expect(response.content[0]?.text).toContain("has been created");

                // Check that the current IP is present in the access list
                const accessList = await session.apiClient.listProjectIpAccessLists({
                    params: { path: { groupId: projectId } },
                });
                const found = accessList.results?.some((entry) => entry.ipAddress === ipInfo.currentIpv4Address);
                expect(found).toBe(true);
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
                expect(response.content).toBeInstanceOf(Array);
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
                expect(response.content).toBeInstanceOf(Array);
                expect(response.content).toHaveLength(2);
                expect(response.content[1]?.text).toContain(`${clusterName} | `);
            });
        });

        describe("atlas-connect-cluster", () => {
            beforeAll(async () => {
                const projectId = getProjectId();
                await waitCluster(integration.mcpServer().session, projectId, clusterName, (cluster) => {
                    return (
                        cluster.stateName === "IDLE" &&
                        (cluster.connectionStrings?.standardSrv || cluster.connectionStrings?.standard) !== undefined
                    );
                });
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

                for (let i = 0; i < 10; i++) {
                    const response = (await integration.mcpClient().callTool({
                        name: "atlas-connect-cluster",
                        arguments: { projectId, clusterName },
                    })) as CallToolResult;
                    expect(response.content).toBeInstanceOf(Array);
                    expect(response.content.length).toBeGreaterThanOrEqual(1);
                    expect(response.content[0]?.type).toEqual("text");
                    const c = response.content[0] as { text: string };
                    if (
                        c.text.includes("Cluster is already connected.") ||
                        c.text.includes(`Connected to cluster "${clusterName}"`)
                    ) {
                        break; // success
                    } else {
                        expect(response.content[0]?.text).toContain(
                            `Attempting to connect to cluster "${clusterName}"...`
                        );
                    }
                    await sleep(500);
                }
            });

            describe("when not connected", () => {
                it("prompts for atlas-connect-cluster when querying mongodb", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: { database: "some-db", collection: "some-collection" },
                    });
                    const elements = getResponseElements(response.content);
                    expect(elements).toHaveLength(2);
                    expect(elements[0]?.text).toContain(
                        "You need to connect to a MongoDB instance before you can access its data."
                    );
                    expect(elements[1]?.text).toContain(
                        'Please use one of the following tools: "atlas-connect-cluster", "connect" to connect to a MongoDB instance'
                    );
                });
            });
        });
    });
});
