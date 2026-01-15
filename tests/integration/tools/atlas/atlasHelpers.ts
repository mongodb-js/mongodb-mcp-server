import { ObjectId } from "mongodb";
import type { ClusterDescription20240805, Group } from "../../../../src/common/atlas/openapi.js";
import type { ApiClient } from "../../../../src/common/atlas/apiClient.js";
import type { IntegrationTest } from "../../helpers.js";
import { setupIntegrationTest, defaultTestConfig } from "../../helpers.js";
import type { SuiteCollector } from "vitest";
import { afterAll, beforeAll, describe } from "vitest";
import type { Session } from "../../../../src/common/session.js";

export type IntegrationTestFunction = (integration: IntegrationTest) => void;

export function describeWithAtlas(name: string, fn: IntegrationTestFunction): void {
    const describeFn =
        !process.env.MDB_MCP_API_CLIENT_ID?.length || !process.env.MDB_MCP_API_CLIENT_SECRET?.length
            ? describe.skip
            : describe;
    describeFn(name, () => {
        const integration = setupIntegrationTest(() => ({
            ...defaultTestConfig,
            apiClientId: process.env.MDB_MCP_API_CLIENT_ID || "test-client",
            apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "test-secret",
            apiBaseUrl: process.env.MDB_MCP_API_BASE_URL ?? "https://cloud-dev.mongodb.com",
        }));
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

type ProjectTestFunction = (args: ProjectTestArgs) => void;

type ClusterTestFunction = (args: ClusterTestArgs) => void;

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
                await apiClient.deleteGroup({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                });
            } catch (error) {
                // send the delete request and ignore errors
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

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertClusterIsAvailable(
    session: Session,
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

export function assertApiClientIsAvailable(session: Session): asserts session is Session & { apiClient: ApiClient } {
    if (!session.apiClient) {
        throw new Error("apiClient not available");
    }
}

export async function deleteCluster(
    session: Session,
    projectId: string,
    clusterName: string,
    shouldWaitTillClusterIsDeleted: boolean = false
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

export async function waitCluster(
    session: Session,
    projectId: string,
    clusterName: string,
    check: (cluster: ClusterDescription20240805) => boolean | Promise<boolean>,
    pollingInterval: number = 1000,
    maxPollingIterations: number = 300
): Promise<void> {
    if (!session.apiClient) {
        throw new Error("apiClient not available");
    }
    for (let i = 0; i < maxPollingIterations; i++) {
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

                await waitCluster(integration.mcpServer().session, projectId, clusterName, (cluster) => {
                    return cluster.stateName === "IDLE";
                });
            });

            afterAll(async () => {
                const session = integration.mcpServer().session;
                assertApiClientIsAvailable(session);
                const apiClient = session.apiClient;

                try {
                    // send the delete request and ignore errors
                    await apiClient.deleteCluster({
                        params: {
                            path: {
                                groupId: getProjectId(),
                                clusterName,
                            },
                        },
                    });
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
