import { ObjectId } from "mongodb";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import type { ApiClient, ClusterDescription20240805, Group } from "@mongodb-js/mcp-atlas-api-client";
import type { IntegrationTest } from "../../integrationHelpers.js";
import { setupIntegrationTest, defaultTestConfig } from "../../integrationHelpers.js";
import type { SuiteCollector } from "vitest";
import { afterAll, beforeAll, describe, inject } from "vitest";
import type { McpSession } from "@mongodb-js/mcp-cli";
import { AllTools } from "mongodb-mcp-server";
import type { StreamsWorkspaceFixture } from "./streamsWorkspace.js";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

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
            const session = integration.mcpServer().session;
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
            const session = integration.mcpServer().session;
            assertApiClientIsAvailable(session);
            const apiClient = session.apiClient;

            try {
                // Self-healing cleanup: remove any leftover stream workspaces and
                // clusters before deleting the project, otherwise Atlas rejects the
                // group deletion and leaks the project (and its clusters) into the org.
                await deleteAllWorkspacesAndWait(apiClient, projectId);
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

export function randomId(): string {
    return new ObjectId().toString();
}

async function createGroup(apiClient: ApiClient): Promise<Group & Required<Pick<Group, "id">>> {
    const projectName: string = `testProj-` + randomId();

    const orgs = await apiClient.listOrgs();
    if (!orgs?.results?.length || !orgs.results[0]?.id) {
        throw new Error("No orgs found");
    }

    const group = await apiClient.createGroup({
        body: {
            name: projectName,
            orgId: orgs.results[0]?.id ?? "",
        } as Group,
    });

    if (!group?.id) {
        throw new Error("Failed to create project");
    }

    // add current IP to project access list
    const { currentIpv4Address } = await apiClient.getIpInfo();
    await apiClient.createAccessListEntry({
        params: {
            path: {
                groupId: group.id,
            },
        },
        body: [
            {
                ipAddress: currentIpv4Address,
                groupId: group.id,
                comment: "Added by MongoDB MCP Server to enable tool access",
            },
        ],
    });

    return group as Group & Required<Pick<Group, "id">>;
}

async function deleteAllWorkspacesAndWait(apiClient: ApiClient, projectId: string): Promise<void> {
    try {
        const workspaces = await apiClient.listStreamWorkspaces({
            params: {
                path: {
                    groupId: projectId,
                },
            },
        });
        for (const workspace of workspaces.results ?? []) {
            if (!workspace.name) {
                continue;
            }
            await apiClient.deleteStreamWorkspace({
                params: {
                    path: {
                        groupId: projectId,
                        tenantName: workspace.name,
                    },
                },
            });
            // Wait for the workspace to be gone (up to 120s each)
            for (let i = 0; i < 120; i++) {
                try {
                    await apiClient.getStreamWorkspace({
                        params: {
                            path: {
                                groupId: projectId,
                                tenantName: workspace.name,
                            },
                        },
                    });
                    await sleep(1000);
                } catch {
                    break;
                }
            }
        }
    } catch (error) {
        // streams may not be enabled on the project
        console.log("Failed to clean up stream workspaces:", error);
    }
}

async function deleteAllClustersAndWait(apiClient: ApiClient, projectId: string): Promise<void> {
    const clusters = await apiClient.listClusters({
        params: {
            path: {
                groupId: projectId,
            },
        },
    });
    for (const cluster of clusters.results ?? []) {
        if (!cluster.name) {
            continue;
        }
        try {
            await apiClient.deleteCluster({
                params: {
                    path: {
                        groupId: projectId,
                        clusterName: cluster.name,
                    },
                },
            });
        } catch (error) {
            console.log(`Failed to delete cluster '${cluster.name}':`, error);
        }
    }

    // Wait until no clusters remain (up to 60 iterations x 10s = 10 min)
    for (let i = 0; i < 60; i++) {
        const remaining = await apiClient.listClusters({
            params: {
                path: {
                    groupId: projectId,
                },
            },
        });
        if (!remaining.results?.length) {
            return;
        }
        await sleep(10_000);
    }
    console.log(`Timed out waiting for all clusters in project '${projectId}' to be deleted, continuing anyway`);
}

async function deleteGroupWithRetry(apiClient: ApiClient, projectId: string): Promise<void> {
    const maxRetries = 10;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await apiClient.deleteGroup({
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
            });
            return;
        } catch (error) {
            // 409 CANNOT_CLOSE_GROUP_ACTIVE_ATLAS_CLUSTERS: Atlas may still be
            // terminating clusters asynchronously, retry with backoff.
            const isConflict = error instanceof ApiClientError && error.response.status === 409;
            if (!isConflict || attempt === maxRetries) {
                throw error;
            }
            console.log(`deleteGroup returned 409, retrying in 30s (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(30_000);
        }
    }
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertClusterIsAvailable(
    session: McpSession,
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
    session: McpSession
): asserts session is McpSession & { apiClient: ApiClient } {
    if (!session.apiClient) {
        throw new Error("apiClient not available");
    }
}

export async function deleteCluster(
    session: McpSession,
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

    // Wait for the cluster to be gone (up to 600 iterations x 1s = 10 min)
    const maxIterations = 600;
    for (let i = 0; i < maxIterations; i++) {
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
            return;
        }
    }
    // A teardown timeout should not fail the suite; withProject's cleanup is the second safety net.
    console.log(`Timed out waiting for cluster '${clusterName}' to be deleted after ${maxIterations} attempts`);
}

export async function waitCluster(
    session: McpSession,
    projectId: string,
    clusterName: string,
    check: (cluster: ClusterDescription20240805) => boolean | Promise<boolean>,
    pollingInterval: number = 1000,
    maxPollingIterations: number = 300
): Promise<void> {
    if (!session.apiClient) {
        throw new Error("apiClient not available");
    }
    const apiClient = session.apiClient as ApiClient;
    let consecutiveErrors = 0;
    for (let i = 0; i < maxPollingIterations; i++) {
        let cluster: ClusterDescription20240805 | undefined;
        try {
            cluster = await apiClient.getCluster({
                params: {
                    path: {
                        groupId: projectId,
                        clusterName,
                    },
                },
            });
            consecutiveErrors = 0;
        } catch (error) {
            // Treat transient errors (e.g. a 404 right after creation) as
            // "condition not met" and keep polling.
            consecutiveErrors++;
            if (consecutiveErrors % 10 === 1) {
                console.log(`waitCluster: getCluster failed ${consecutiveErrors} time(s), continuing to poll:`, error);
            }
        }
        if (cluster && (await check(cluster))) {
            return;
        }
        await sleep(pollingInterval);
    }

    throw new Error(
        `Cluster wait timeout: ${clusterName} did not meet condition within ${maxPollingIterations} iterations`
    );
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
                const session = integration.mcpServer().session;
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
                    integration.mcpServer().session,
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
                const session = integration.mcpServer().session;
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
