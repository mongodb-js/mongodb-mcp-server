import { ObjectId } from "mongodb";
import type { ClusterDescription20240805, Group } from "../../../../src/common/atlas/openapi.js";
import type { ApiClient } from "../../../../src/common/atlas/apiClient.js";
import type { IntegrationTest } from "../../helpers.js";
import { setupIntegrationTest, defaultTestConfig, defaultDriverOptions } from "../../helpers.js";
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
        const integration = setupIntegrationTest(
            () => ({
                ...defaultTestConfig,
                apiClientId: process.env.MDB_MCP_API_CLIENT_ID || "test-client",
                apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "test-secret",
                apiBaseUrl: process.env.MDB_MCP_API_BASE_URL ?? "https://cloud-dev.mongodb.com",
            }),
            () => defaultDriverOptions
        );
        fn(integration);
    });
}

interface ProjectTestArgs {
    getProjectId: () => string;
    getIpAddress: () => string;
}

type ProjectTestFunction = (args: ProjectTestArgs) => void;

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
            const apiClient = integration.mcpServer().session.apiClient;

            // check that it has credentials
            if (!apiClient.hasCredentials()) {
                throw new Error("No credentials available");
            }

            // validate access token
            await apiClient.validateAccessToken();
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

        afterAll(() => {
            if (!projectId) {
                return;
            }

            const apiClient = integration.mcpServer().session.apiClient;

            // send the delete request and ignore errors
            apiClient
                .deleteGroup({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                })
                .catch((error) => {
                    console.log("Failed to delete project:", error);
                });
        });

        const args = {
            getProjectId: (): string => projectId,
            getIpAddress: (): string => ipAddress,
        };

        fn(args);
    });
}

export const randomId = new ObjectId().toString();

async function createGroup(apiClient: ApiClient): Promise<Group & Required<Pick<Group, "id">>> {
    const projectName: string = `testProj-` + randomId;

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

export async function deleteCluster(
    session: Session,
    projectId: string,
    clusterName: string,
    shouldWaitTillClusterIsDeleted: boolean = false
): Promise<void> {
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
