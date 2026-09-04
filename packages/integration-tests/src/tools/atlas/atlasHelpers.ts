import type { ApiClient, ClusterDescription20240805 } from "@mongodb-js/mcp-atlas-api-client";
import type { IntegrationTest } from "../../integrationHelpers.js";
import { setupIntegrationTest, defaultTestConfig } from "../../integrationHelpers.js";
import type { SuiteCollector } from "vitest";
import { afterAll, beforeAll, describe, inject } from "vitest";
import { AllTools, type CliServer } from "mongodb-mcp-server";
import type { StreamsWorkspaceFixture } from "./streamsWorkspace.js";
import {
    createGroup,
    deleteAllClustersAndWait,
    deleteGroupWithRetry,
    deleteStreamWorkspacesAndWait,
    randomId,
    waitForClusterDeletion,
    waitForClusterState,
} from "./atlasProvisioning.js";

// Re-exported for callers that historically imported these from here.
export { randomId } from "./atlasProvisioning.js";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

/** A CliServer narrowed to have a usable Atlas `ApiClient`. */
export type AtlasTestServer = CliServer & { apiClient: ApiClient };

export function describeWithAtlas(name: string, fn: IntegrationTestFunction): void {
    const describeFn =
        !process.env.MDB_MCP_API_CLIENT_ID?.length || !process.env.MDB_MCP_API_CLIENT_SECRET?.length
            ? describe.skip
            : describe;
    describeFn(name, () => {
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                apiClientId: process.env.MDB_MCP_API_CLIENT_ID || "test-client",
                apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "test-secret",
                apiBaseUrl: process.env.MDB_MCP_API_BASE_URL ?? "https://cloud-dev.mongodb.com",
            }),
            { tools: AllTools }
        );
        fn(integration);
    });
}

export function describeWithStreams(name: string, fn: IntegrationTestFunction): void {
    const describeFn =
        !process.env.MDB_MCP_API_CLIENT_ID?.length || !process.env.MDB_MCP_API_CLIENT_SECRET?.length
            ? describe.skip
            : describe;
    describeFn(name, () => {
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                apiClientId: process.env.MDB_MCP_API_CLIENT_ID || "test-client",
                apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "test-secret",
                apiBaseUrl: process.env.MDB_MCP_API_BASE_URL ?? "https://cloud-dev.mongodb.com",
                previewFeatures: [],
            }),
            { tools: AllTools }
        );
        fn(integration);
    });
}

interface ProjectTestArgs {
    getProjectId: () => string;
    getIpAddress: () => string;
}

interface ClusterTestArgs {
    getProjectId: () => string;
    getIpAddress: () => string;
    getClusterName: () => string;
}

interface WorkspaceTestArgs {
    getProjectId: () => string;
    getWorkspaceName: () => string;
    getClusterConnectionName: () => string;
}

type ProjectTestFunction = (args: ProjectTestArgs) => void;

type ClusterTestFunction = (args: ClusterTestArgs) => void;

type WorkspaceTestFunction = (args: WorkspaceTestArgs) => void;

export function withCredentials(integration: IntegrationTest, fn: IntegrationTestFunction): SuiteCollector<object> {
    const describeFn =
        !process.env.MDB_MCP_API_CLIENT_ID?.length || !process.env.MDB_MCP_API_CLIENT_SECRET?.length
            ? describe.skip
            : describe;
    return describeFn("with credentials", () => {
        fn(integration);
    });
}

export function withProject(integration: IntegrationTest, fn: ProjectTestFunction): SuiteCollector<object> {
    return describe("with project", () => {
        let projectId: string = "";
        let ipAddress: string = "";

        beforeAll(async () => {
            const session = integration.mcpServer();
            assertApiClientIsAvailable(session);
            const apiClient = session.apiClient;

            // check that it has credentials
            if (!apiClient.isAuthConfigured()) {
                throw new Error("No credentials available");
            }

            // validate access token
            await apiClient.validateAuthConfig();
            try {
                const group = await createGroup(apiClient);
                const ipInfo = await apiClient.getIpInfo();
                ipAddress = ipInfo.currentIpv4Address;
                projectId = group.id;
            } catch (error) {
                console.error("Failed to create project:", error);
                throw error;
            }
        });

        afterAll(async () => {
            if (!projectId) {
                return;
            }
            const session = integration.mcpServer();
            assertApiClientIsAvailable(session);
            const apiClient = session.apiClient;

            try {
                // Self-healing cleanup: remove any leftover stream workspaces and
                // clusters before deleting the project, otherwise Atlas rejects the
                // group deletion and leaks the project (and its clusters) into the org.
                await deleteStreamWorkspacesAndWait(apiClient, projectId);
                await deleteAllClustersAndWait(apiClient, projectId);
                await deleteGroupWithRetry(apiClient, projectId);
            } catch (error) {
                // teardown failures should not fail the suite
                console.log("Failed to delete group:", error);
            }
        });

        const args = {
            getProjectId: (): string => projectId,
            getIpAddress: (): string => ipAddress,
        };

        fn(args);
    });
}

export async function assertClusterIsAvailable(
    session: CliServer,
    projectId: string,
    clusterName: string
): Promise<boolean> {
    assertApiClientIsAvailable(session);
    try {
        await session.apiClient.getCluster({
            params: {
                path: {
                    groupId: projectId,
                    clusterName,
                },
            },
        });
        return true;
    } catch {
        return false;
    }
}

export function assertApiClientIsAvailable(
    session: CliServer
): asserts session is CliServer & { apiClient: ApiClient } {
    if (!session.apiClient) {
        throw new Error("apiClient not available");
    }
}

export async function deleteCluster(
    session: CliServer,
    projectId: string,
    clusterName: string,
    shouldWaitTillClusterIsDeleted: boolean = true
): Promise<void> {
    assertApiClientIsAvailable(session);
    await session.apiClient.deleteCluster({
        params: {
            path: {
                groupId: projectId,
                clusterName,
            },
        },
    });

    if (!shouldWaitTillClusterIsDeleted) {
        return;
    }

    await waitForClusterDeletion(session.apiClient, projectId, clusterName);
}

export async function waitCluster(
    session: CliServer,
    projectId: string,
    clusterName: string,
    check: (cluster: ClusterDescription20240805) => boolean | Promise<boolean>,
    pollingInterval: number = 1000,
    maxPollingIterations: number = 300
): Promise<void> {
    assertApiClientIsAvailable(session);
    await waitForClusterState(session.apiClient, projectId, clusterName, check, pollingInterval, maxPollingIterations);
}

export function withCluster(integration: IntegrationTest, fn: ClusterTestFunction): SuiteCollector<object> {
    return withProject(integration, ({ getProjectId, getIpAddress }) => {
        describe("with cluster", () => {
            const clusterName: string = `test-cluster-${randomId()}`;

            beforeAll(async () => {
                const projectId = getProjectId();

                const input = {
                    groupId: projectId,
                    name: clusterName,
                    clusterType: "REPLICASET",
                    replicationSpecs: [
                        {
                            zoneName: "Zone 1",
                            regionConfigs: [
                                {
                                    providerName: "TENANT",
                                    backingProviderName: "AWS",
                                    regionName: "US_EAST_1",
                                    electableSpecs: {
                                        instanceSize: "M0",
                                    },
                                },
                            ],
                        },
                    ],
                    terminationProtectionEnabled: false,
                } as unknown as ClusterDescription20240805;
                const session = integration.mcpServer();
                assertApiClientIsAvailable(session);
                await session.apiClient.createCluster({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                    body: input,
                });

                // M0 provisioning on cloud-dev is slow and non-deterministic (observed
                // to exceed 10 minutes), so allow up to 20 minutes (10s x 120); a hook
                // timeout here would silently skip every test in the suite.
                await waitCluster(
                    integration.mcpServer(),
                    projectId,
                    clusterName,
                    (cluster) => {
                        return cluster.stateName === "IDLE";
                    },
                    10_000,
                    120
                );
            }, 1_500_000);

            afterAll(async () => {
                const session = integration.mcpServer();
                assertApiClientIsAvailable(session);

                try {
                    // delete the cluster and wait for termination, but ignore errors
                    await deleteCluster(session, getProjectId(), clusterName);
                } catch (error) {
                    console.log("Failed to delete cluster:", error);
                }
            });

            const args = {
                getProjectId: (): string => getProjectId(),
                getIpAddress: (): string => getIpAddress(),
                getClusterName: (): string => clusterName,
            };

            fn(args);
        });
    });
}

export function withWorkspace(integration: IntegrationTest, fn: WorkspaceTestFunction): SuiteCollector<object> {
    const fixture: StreamsWorkspaceFixture | undefined = inject("atlasStreamsWorkspace");

    return describe("with workspace", () => {
        beforeAll(() => {
            if (!fixture) {
                throw new Error(
                    "Shared Atlas Streams workspace was not provisioned. " +
                        "Streams integration tests must run under the 'streams-tests' project with " +
                        "MDB_MCP_API_CLIENT_ID / MDB_MCP_API_CLIENT_SECRET configured so that streamsGlobalSetup.ts " +
                        "can provision the shared project + workspace + cluster."
                );
            }
        });

        const args = {
            getProjectId: (): string => fixture?.projectId ?? "",
            getWorkspaceName: (): string => fixture?.workspaceName ?? "",
            getClusterConnectionName: (): string => fixture?.clusterConnectionName ?? "",
        };

        fn(args);
    });
}
