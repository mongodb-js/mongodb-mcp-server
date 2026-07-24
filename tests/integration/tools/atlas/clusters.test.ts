import { sleep } from "../../../../src/common/managedTimeout.js";
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
    assertApiClientIsAvailable,
} from "./atlasHelpers.js";
import { afterAll, beforeAll, describe, expect, it, vitest } from "vitest";

function isAzureCMKTestConfigMissing(): boolean {
    return (
        !process.env.MDB_MCP_AZURE_CMK_SUBSCRIPTION_ID ||
        !process.env.MDB_MCP_AZURE_CMK_TENANT_ID ||
        !process.env.MDB_MCP_AZURE_CMK_ATLAS_APP_ID ||
        !process.env.MDB_MCP_AZURE_CMK_SERVICE_PRINCIPAL_ID ||
        !process.env.MDB_MCP_AZURE_CMK_RESOURCE_GROUP_NAME ||
        !process.env.MDB_MCP_AZURE_CMK_KEY_VAULT_NAME ||
        !process.env.MDB_MCP_AZURE_CMK_KEY_IDENTIFIER
    );
}

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

                expectDefined(response.structuredContent);
                expect(response.structuredContent).toEqual({
                    created: true,
                });

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
                expect(content).toContain('"provider"');
                expect(content).toContain('"region"');
                expect(content).toContain('"paused"');

                expectDefined(response.structuredContent);
                expect(response.structuredContent).toMatchObject({
                    name: clusterName,
                    instanceType: "FREE",
                    instanceSize: "N/A",
                    provider: "AWS",
                    region: "US_EAST_1",
                    paused: false,
                    mongoDBVersion: expect.any(String) as string,
                    state: expect.any(String) as string,
                    connectionStrings: expect.any(Object) as Record<string, string>,
                });
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
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                const listClustersSpy = vitest.spyOn(session.apiClient, "listClusters");
                const listFlexClustersSpy = vitest.spyOn(session.apiClient, "listFlexClusters");

                const projectId = getProjectId();
                const response = await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-clusters", arguments: { projectId } });

                const content = getResponseContent(response.content);
                expect(content).toContain("<untrusted-user-data-");
                expect(content).toMatch(/Found \d+ clusters in project/);
                expect(content).toContain(projectId);
                expect(listClustersSpy).toHaveBeenCalledTimes(1);
                expect(listFlexClustersSpy).toHaveBeenCalledTimes(1);

                expectDefined(response.structuredContent);
                const structuredContent = response.structuredContent as {
                    projectId: string;
                    totalCount: number;
                    clusters: Array<{ name?: string; instanceType?: string }>;
                };
                expect(structuredContent.projectId).toBe(projectId);
                expect(structuredContent.totalCount).toBeGreaterThanOrEqual(1);
                expect(
                    structuredContent.clusters.some(
                        (cluster) => cluster.name === clusterName && cluster.instanceType === "FREE"
                    )
                ).toBe(true);
            });

            it("returns clusters when listFlexClusters fails", async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                vitest
                    .spyOn(session.apiClient, "listFlexClusters")
                    .mockRejectedValue(new Error("Flex clusters not available"));

                const projectId = getProjectId();
                const response = await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-clusters", arguments: { projectId } });

                const content = getResponseContent(response.content);
                expect(content).toMatch(/Found \d+ clusters in project/);
                expect(content).toContain(projectId);

                expectDefined(response.structuredContent);
                const structuredContent = response.structuredContent as {
                    projectId: string;
                    totalCount: number;
                    clusters: Array<{ name?: string }>;
                };
                expect(structuredContent.projectId).toBe(projectId);
                expect(structuredContent.totalCount).toBeGreaterThanOrEqual(1);
                expect(structuredContent.clusters.some((cluster) => cluster.name === clusterName)).toBe(true);
            });

            it("returns clusters when listClusters fails", async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                vitest.spyOn(session.apiClient, "listClusters").mockRejectedValue(new Error("Clusters not available"));

                const projectId = getProjectId();
                const response = await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-clusters", arguments: { projectId } });

                const content = getResponseContent(response.content);
                expect(content).toBeDefined();

                expectDefined(response.structuredContent);
                const structuredContent = response.structuredContent as {
                    projectId: string;
                    totalCount: number;
                    clusters: unknown[];
                };
                expect(structuredContent.projectId).toBe(projectId);
                expect(typeof structuredContent.totalCount).toBe("number");
                expect(Array.isArray(structuredContent.clusters)).toBe(true);
            });

            it("returns a successful empty result when no clusters exist across all projects", async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                vitest.spyOn(session.apiClient, "listClusterDetails").mockResolvedValue({ results: [], totalCount: 0 });

                const response = await integration.mcpClient().callTool({ name: "atlas-list-clusters", arguments: {} });

                expect(response.isError).toBeFalsy();
                expect(getResponseContent(response.content)).toContain("No clusters found.");
                expect(response.structuredContent).toEqual({
                    clusters: [],
                    totalCount: 0,
                });
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
                    expect(content).toContain(clusterName);
                    const structuredContent = response.structuredContent as ConnectClusterOutput;
                    if (content.includes(`Connected to cluster "${clusterName}"`)) {
                        connected = true;

                        // Repeat calls reuse the in-flight entry, so however many
                        // polls it took, exactly one temporary user exists.
                        expect(createDatabaseUserSpy).toHaveBeenCalledTimes(1);

                        // The temporary-user note is attached by the call that
                        // provisioned the user — the first one.
                        if (structuredContent.createdTemporaryUser) {
                            expect(content).toContain(
                                "Note: A temporary user has been created to enable secure connection to the cluster. For more information, see https://dochub.mongodb.org/core/mongodb-mcp-server-tools-considerations"
                            );
                        }

                        // structuredContent must mirror content
                        expect(structuredContent.state).toBe("connected");
                        expect(structuredContent.createdTemporaryUser).toBe(
                            content.includes("A temporary user has been created")
                        );
                        expect(structuredContent.addedCurrentIp).toBe(content.includes("IP address has been added"));
                        expect(structuredContent.sharedTierAlertsDetected ?? false).toBe(
                            content.includes("shared-tier threshold alerts")
                        );

                        break;
                    } else {
                        expect(content).toContain(`Attempting to connect to cluster "${clusterName}"`);
                        expect(structuredContent.state).toBe("connecting");
                    }
                    await sleep(500);
                }
                expect(connected).toBe(true);
            });

            describe("when connected", () => {
                withCluster(
                    integration,
                    ({ getProjectId: getSecondaryProjectId, getClusterName: getSecondaryClusterName }) => {
                        let secondaryConnectionId: string;

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
                                    secondaryConnectionId = (response.structuredContent as ConnectClusterOutput)
                                        .connectionId;
                                    break;
                                }

                                await sleep(500);
                            }

                            if (!connected) {
                                throw new Error("Could not connect to cluster before tests");
                            }
                        });

                        it("deletes the temporary database user when the connection is disconnected", async () => {
                            const session = integration.mcpServer().session;
                            assertApiClientIsAvailable(session);
                            const deleteDatabaseUserSpy = vitest.spyOn(session.apiClient, "deleteDatabaseUser");

                            await integration.mcpClient().callTool({
                                name: "disconnect",
                                arguments: { connectionId: secondaryConnectionId },
                            });

                            expect(deleteDatabaseUserSpy).toHaveBeenCalledTimes(1);
                        });
                    }
                );
            });

            describe("when not connected", () => {
                beforeAll(async () => {
                    const registry = integration.mcpServer().session.connectionRegistry;
                    for (const entry of await registry.find(() => true)) {
                        await registry.disconnect(entry.connectionId);
                    }
                });

                it("prompts for atlas-connect-cluster when querying mongodb with an unknown connectionId", async () => {
                    const response = await integration.mcpClient().callTool({
                        name: "find",
                        arguments: {
                            connectionId: "unknown-connection-id",
                            database: "some-db",
                            collection: "some-collection",
                        },
                    });
                    const content = getResponseContent(response.content);
                    expect(content).toContain('Connection "unknown-connection-id" does not exist or has expired.');
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
        });
    });

    withProject(integration, ({ getProjectId }) => {
        let clusterName = "";

        afterAll(async () => {
            const projectId = getProjectId();
            if (projectId && clusterName) {
                const session: Session = integration.mcpServer().session;
                await deleteCluster(session, projectId, clusterName);
            }
            clusterName = "";
        });

        describe("atlas-create-cluster", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const tool = tools.find((t) => t.name === "atlas-create-cluster");

                expectDefined(tool);
                expect(tool.inputSchema.type).toBe("object");
                expectDefined(tool.inputSchema.properties);

                const properties = tool.inputSchema.properties;
                expect(properties).toHaveProperty("projectId");
                expect(properties).toHaveProperty("clusterName");
                expect(properties).toHaveProperty("provider");
                expect(properties).toHaveProperty("region");
                expect(properties).toHaveProperty("clusterType");
                expect(properties).toHaveProperty("instanceSize");
                expect(properties).toHaveProperty("computeAutoScaling");
                expect(properties).toHaveProperty("diskSizeGB");
                expect(properties).toHaveProperty("mongoDBVersion");
                expect(properties).toHaveProperty("backup");
                expect(properties).toHaveProperty("terminationProtectionEnabled");
                expect(properties).toHaveProperty("encryptionAtRestProvider");

                const required = tool.inputSchema.required as string[];
                expect(required).toContain("projectId");
                expect(required).toContain("clusterName");
                expect(required).toContain("provider");
                expect(required).toContain("region");
            });

            it("creates a dedicated cluster", async () => {
                clusterName = "ClusterTest-" + randomId();
                const projectId = getProjectId();

                const response = await integration.mcpClient().callTool({
                    name: "atlas-create-cluster",
                    arguments: {
                        projectId,
                        clusterName,
                        provider: "AWS",
                        region: "US_EAST_1",
                        instanceSize: "M10",
                        diskSizeGB: 20,
                        encryptionAtRestProvider: "NONE",
                    },
                });

                expect(response.isError).toBeFalsy();

                const content = getResponseContent(response.content);
                expect(content).toContain(clusterName);
                expect(content).toContain(projectId);
                expect(content).toContain("atlas-inspect-cluster");
                expect(content).toContain("IDLE");

                expect(response.structuredContent).toMatchObject({
                    provider: "AWS",
                    region: "US_EAST_1",
                    instanceSize: "M10",
                    clusterType: "REPLICASET",
                    mongoDBVersion: "LATEST",
                    backup: "SNAPSHOT",
                    computeAutoScaling: true,
                    terminationProtectionEnabled: false,
                    diskSizeGB: 20,
                    encryptionAtRestProvider: "NONE",
                });
            });

            it.skipIf(isAzureCMKTestConfigMissing())(
                "defaults encryption at rest to Azure when the project has a valid Azure configuration",
                async () => {
                    clusterName = "ClusterCMKTest-" + randomId();
                    const subscriptionId = process.env.MDB_MCP_AZURE_CMK_SUBSCRIPTION_ID;
                    const tenantId = process.env.MDB_MCP_AZURE_CMK_TENANT_ID;
                    const atlasAzureAppId = process.env.MDB_MCP_AZURE_CMK_ATLAS_APP_ID;
                    const servicePrincipalId = process.env.MDB_MCP_AZURE_CMK_SERVICE_PRINCIPAL_ID;
                    const resourceGroupName = process.env.MDB_MCP_AZURE_CMK_RESOURCE_GROUP_NAME;
                    const keyVaultName = process.env.MDB_MCP_AZURE_CMK_KEY_VAULT_NAME;
                    const keyIdentifier = process.env.MDB_MCP_AZURE_CMK_KEY_IDENTIFIER;

                    const projectId = getProjectId();
                    const session = integration.mcpServer().session;
                    assertApiClientIsAvailable(session);

                    const providerAccess: unknown = await session.apiClient.createCloudProviderAccess({
                        params: { path: { groupId: projectId } },
                        body: {
                            providerName: "AZURE",
                            atlasAzureAppId,
                            servicePrincipalId,
                            tenantId,
                        } as never,
                    });
                    console.log("providerAccess");
                    console.log(providerAccess);
                    const roleId = (providerAccess as { _id?: string })._id;
                    expectDefined(roleId);

                    await session.apiClient.authorizeProviderAccessRole({
                        params: { path: { groupId: projectId, roleId } },
                        body: {
                            providerName: "AZURE",
                            atlasAzureAppId,
                            servicePrincipalId,
                            tenantId,
                        } as never,
                    });

                    const encryptionAtRest = await session.apiClient.updateEncryptionAtRest({
                        params: { path: { groupId: projectId } },
                        body: {
                            azureKeyVault: {
                                enabled: true,
                                azureEnvironment: "AZURE",
                                roleId,
                                subscriptionID: subscriptionId,
                                resourceGroupName,
                                keyVaultName,
                                keyIdentifier,
                            },
                        } as never,
                    });
                    console.log("encryptionAtRest");
                    console.log(encryptionAtRest);
                    expect(encryptionAtRest.azureKeyVault).toMatchObject({ enabled: true, valid: true });

                    const response = await integration.mcpClient().callTool({
                        name: "atlas-create-cluster",
                        arguments: {
                            projectId,
                            clusterName: clusterName,
                            provider: "AZURE",
                            region: "US_EAST_2",
                            instanceSize: "M10",
                        },
                    });

                    console.log("response");
                    console.log(response);

                    expect(response.isError).toBeFalsy();
                    expect(response.structuredContent).toMatchObject({
                        encryptionAtRestProvider: "AZURE",
                    });
                }
            );
        });

        describe("atlas-pause-resume-cluster", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const tool = tools.find((t) => t.name === "atlas-pause-resume-cluster");

                expectDefined(tool);
                expect(tool.inputSchema.type).toBe("object");
                expectDefined(tool.inputSchema.properties);
                expect(tool.inputSchema.properties).toHaveProperty("projectId");
                expect(tool.inputSchema.properties).toHaveProperty("clusterName");
                expect(tool.inputSchema.properties).toHaveProperty("action");

                const required = tool.inputSchema.required as string[];
                expect(required).toContain("projectId");
                expect(required).toContain("clusterName");
                expect(required).toContain("action");
            });

            it("pauses and resumes a dedicated cluster", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;
                const pollingInterval = 10000;
                const maxPollingIterations = 120;

                await waitCluster(
                    session,
                    projectId,
                    clusterName,
                    (c) => c.stateName === "IDLE",
                    pollingInterval,
                    maxPollingIterations
                );

                const pauseResponse = await integration.mcpClient().callTool({
                    name: "atlas-pause-resume-cluster",
                    arguments: { projectId, clusterName, action: "PAUSE" },
                });
                expect(pauseResponse.isError).toBeFalsy();
                const pauseContent = getResponseContent(pauseResponse.content);
                expect(pauseContent).toContain(clusterName);
                expect(pauseContent).toContain(projectId);
                expect(pauseContent).toContain("paused");
                expect(pauseResponse.structuredContent).toMatchObject({
                    clusterName,
                    action: "PAUSE",
                });

                await waitCluster(
                    session,
                    projectId,
                    clusterName,
                    (c) => c.paused === true,
                    pollingInterval,
                    maxPollingIterations
                );

                const resumeResponse = await integration.mcpClient().callTool({
                    name: "atlas-pause-resume-cluster",
                    arguments: { projectId, clusterName, action: "RESUME" },
                });
                expect(resumeResponse.isError).toBeFalsy();
                const resumeContent = getResponseContent(resumeResponse.content);
                expect(resumeContent).toContain(clusterName);
                expect(resumeContent).toContain(projectId);
                expect(resumeContent).toContain("atlas-inspect-cluster");
                expect(resumeContent).toContain("IDLE");
                expect(resumeResponse.structuredContent).toMatchObject({
                    clusterName,
                    action: "RESUME",
                });
            });
        });
    });
});
