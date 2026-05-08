import type { Session } from "../../../../src/common/session.js";
import type { ConnectClusterOutput } from "../../../../src/tools/atlas/connect/connectCluster.js";
import { expectDefined, getResponseContent } from "../../helpers.js";
import {
    describeWithAtlas,
    withProject,
    withCluster,
    randomId,
    deleteCluster,
    waitCluster,
    sleep,
    assertApiClientIsAvailable,
} from "./atlasHelpers.js";
import { afterAll, beforeAll, describe, expect, it, vitest } from "vitest";

describeWithAtlas("clusters", (integration) => {
    withProject(integration, ({ getProjectId, getIpAddress }) => {
        const clusterName = "ClusterTest-" + randomId();

        afterAll(async () => {
            const projectId = getProjectId();
            if (projectId) {
                const session: Session = integration.mcpServer().session;
                await deleteCluster(session, projectId, clusterName);
            }
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

                const response = await integration.mcpClient().callTool({
                    name: "atlas-create-free-cluster",
                    arguments: {
                        projectId,
                        name: clusterName,
                        region: "US_EAST_1",
                    },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("Cluster");
                expect(content).toContain(clusterName);
                expect(content).toContain("has been created");
                expect(content).toContain("US_EAST_1");

                assertApiClientIsAvailable(session);
                // Check that the current IP is present in the access list
                const accessList = await session.apiClient.listAccessListEntries({
                    params: { path: { groupId: projectId } },
                });
                const found = accessList.results?.some((entry) => entry.ipAddress === getIpAddress());
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

                const response = await integration.mcpClient().callTool({
                    name: "atlas-inspect-cluster",
                    arguments: { projectId, clusterName: clusterName },
                });
                const content = getResponseContent(response.content);
                expect(content).toContain("Cluster details:");
                expect(content).toContain("<untrusted-user-data-");
                expect(content).toContain(clusterName);
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

                const response = await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-clusters", arguments: { projectId } });

                const content = getResponseContent(response.content);
                expect(content).toContain("<untrusted-user-data-");
                expect(content).toMatch(/Found \d+ clusters in project/);
                expect(content).toContain(projectId);
            });
        });

        describe("atlas-connect-cluster", () => {
            beforeAll(async () => {
                const projectId = getProjectId();
                const ipAddress = getIpAddress();
                await waitCluster(integration.mcpServer().session, projectId, clusterName, (cluster) => {
                    return (
                        cluster.stateName === "IDLE" &&
                        (cluster.connectionStrings?.standardSrv || cluster.connectionStrings?.standard) !== undefined
                    );
                });
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                await session.apiClient.createAccessListEntry({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                    body: [
                        {
                            comment: "MCP test",
                            ipAddress: ipAddress,
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
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                const createDatabaseUserSpy = vitest.spyOn(session.apiClient, "createDatabaseUser");

                const projectId = getProjectId();
                const connectionType = "standard";
                let connected = false;

                for (let i = 0; i < 10; i++) {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-connect-cluster",
                        arguments: { projectId, clusterName, connectionType },
                    });

                    const content = getResponseContent(response.content);
                    expect(content).toContain("Connected to cluster");
                    expect(content).toContain(clusterName);
                    const structuredContent = response.structuredContent as ConnectClusterOutput;
                    if (content.includes(`Connected to cluster "${clusterName}"`)) {
                        connected = true;

                        expect(createDatabaseUserSpy).toHaveBeenCalledTimes(1);

                        // assert that some of the element s have the message
                        expect(content).toContain(
                            "Note: A temporary user has been created to enable secure connection to the cluster. For more information, see https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations"
                        );

                        // structuredContent must mirror content
                        expect(structuredContent.connected).toBe(true);
                        expect(structuredContent.createdTemporaryUser).toBe(
                            content.includes("A temporary user has been created")
                        );
                        expect(structuredContent.addedCurrentIp).toBe(content.includes("IP address has been added"));
                        expect(structuredContent.sharedTierAlertsDetected ?? false).toBe(
                            content.includes("shared-tier threshold alerts")
                        );

                        break;
                    } else {
                        expect(content).toContain(`Attempting to connect to cluster "${clusterName}"...`);
                        expect(structuredContent.connected).toBe(false);
                    }
                    await sleep(500);
                }
                expect(connected).toBe(true);
            });

            describe("when connected", () => {
                withCluster(
                    integration,
                    ({ getProjectId: getSecondaryProjectId, getClusterName: getSecondaryClusterName }) => {
                        beforeAll(async () => {
                            let connected = false;
                            for (let i = 0; i < 10; i++) {
                                const response = await integration.mcpClient().callTool({
                                    name: "atlas-connect-cluster",
                                    arguments: {
                                        projectId: getSecondaryProjectId(),
                                        clusterName: getSecondaryClusterName(),
                                        connectionType: "standard",
                                    },
                                });

                                const content = getResponseContent(response.content);

                                if (content.includes(`Connected to cluster "${getSecondaryClusterName()}"`)) {
                                    connected = true;
                                    break;
                                }

                                await sleep(500);
                            }

                            if (!connected) {
                                throw new Error("Could not connect to cluster before tests");
                            }
                        });

                        it("disconnects and deletes the database user before connecting to another cluster", async () => {
                            const session = integration.mcpServer().session;
                            assertApiClientIsAvailable(session);
                            const deleteDatabaseUserSpy = vitest.spyOn(session.apiClient, "deleteDatabaseUser");

                            await integration.mcpClient().callTool({
                                name: "atlas-connect-cluster",
                                arguments: {
                                    projectId: getProjectId(),
                                    clusterName: clusterName,
                                    connectionType: "standard",
                                },
                            });

                            expect(deleteDatabaseUserSpy).toHaveBeenCalledTimes(1);
                        });
                    }
                );
            });

            describe("when not connected", () => {
                beforeAll(async () => {
                    await integration.mcpServer().session.disconnect();
                });

                it("prompts for atlas-connect-cluster when querying mongodb", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: { database: "some-db", collection: "some-collection" },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain(
                        "You need to connect to a MongoDB instance before you can access its data."
                    );
                    // Check if the response contains all available test tools.
                    if (process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true") {
                        // The tool atlas-local-connect-deployment may be disabled in some test environments if Docker is not available.
                        expect(content).toContain(
                            'Please use one of the following tools: "atlas-connect-cluster", "connect" to connect to a MongoDB instance'
                        );
                    } else {
                        expect(content).toContain(
                            'Please use one of the following tools: "atlas-connect-cluster", "atlas-local-connect-deployment", "connect" to connect to a MongoDB instance'
                        );
                    }
                });
            });
        });
        describe("atlas-upgrade-cluster", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const upgradeCluster = tools.find((tool) => tool.name === "atlas-upgrade-cluster");

                expectDefined(upgradeCluster);
                expect(upgradeCluster.inputSchema.type).toBe("object");
                expectDefined(upgradeCluster.inputSchema.properties);
                expect(upgradeCluster.inputSchema.properties).toHaveProperty("projectId");
                expect(upgradeCluster.inputSchema.properties).toHaveProperty("clusterName");
                expect(upgradeCluster.inputSchema.properties).toHaveProperty("targetTier");
                expect(upgradeCluster.inputSchema.properties).toHaveProperty("provider");
                expect(upgradeCluster.inputSchema.properties).toHaveProperty("region");
            });

            withCluster(integration, ({ getProjectId: getUpgradeProjectId, getClusterName: getUpgradeClusterName }) => {
                // This withCluster creates a dedicated FREE cluster for the upgrade test.
                // The test makes a real upgrade API call; withCluster's cleanup handles teardown regardless of tier.
                describe("when not connected to the cluster being upgraded", () => {
                    it("upgrades FREE cluster to FLEX with explicit projectId and clusterName", async () => {
                        const response = await integration.mcpClient().callTool({
                            name: "atlas-upgrade-cluster",
                            arguments: {
                                projectId: getUpgradeProjectId(),
                                clusterName: getUpgradeClusterName(),
                            },
                        });
                        const content = getResponseContent(response.content);
                        expect(content).toContain(getUpgradeClusterName());
                        expect(content).toContain("being upgraded");
                    });
                });
            });

            // Simulates being "connected" to the outer cluster (created by atlas-create-free-cluster above).
            // The session state is patched so the tool picks up projectId/clusterName without explicit args,
            // then makes a real upgrade API call against that outer cluster.
            describe("when connected to the cluster being upgraded", () => {
                beforeAll(() => {
                    const session: Session = integration.mcpServer().session;
                    (session.connectionManager as unknown as { state: unknown }).state = {
                        tag: "disconnected",
                        connectedAtlasCluster: {
                            username: "testuser",
                            projectId: getProjectId(),
                            clusterName,
                            instanceType: "FREE" as const,
                            provider: "AWS",
                            region: "US_EAST_1",
                            expiryDate: new Date(Date.now() + 3_600_000),
                        },
                    };
                });

                afterAll(() => {
                    const session: Session = integration.mcpServer().session;
                    (session.connectionManager as unknown as { state: unknown }).state = { tag: "disconnected" };
                });

                it("upgrades FREE cluster to FLEX using session state without explicit params", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "atlas-upgrade-cluster",
                        arguments: {},
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain(clusterName);
                    expect(content).toContain("being upgraded");
                });
            });
        });
    });
});
