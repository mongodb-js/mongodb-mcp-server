import { ObjectId } from "mongodb";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import type { ApiClient, ClusterDescription20240805, Group } from "@mongodb-js/mcp-atlas-api-client";
import { sleep } from "@mongodb-js/mcp-core";

/**
 * Shared Atlas provisioning primitives used by both the argument-based suites
 * (`atlasHelpers.ts`) and the streams shared-workspace fixture
 * (`streamsWorkspace.ts`). All helpers take an `ApiClient` directly (no MCP
 * session) so they are reusable from vitest globalSetup where no server
 * session exists.
 */

export function randomId(): string {
    return new ObjectId().toString();
}

/**
 * Creates a project in the test org: the pinned org
 * (`DEV_ATLAS_MCP_ORG_ID`) when configured, otherwise the first org returned
 * by the API (with the test credentials this is the single "MongoDB MCP Test"
 * org the hourly cleanup job scans). Adds the current IP to the project access
 * list so the test host can reach provisioned clusters.
 */
export async function createGroup(apiClient: ApiClient): Promise<Group & Required<Pick<Group, "id">>> {
    const projectName: string = `testProj-` + randomId();

    let orgId: string | undefined = process.env.DEV_ATLAS_MCP_ORG_ID;
    if (!orgId) {
        const orgs = await apiClient.listOrgs();
        orgId = orgs?.results?.[0]?.id;
    }
    if (!orgId) {
        throw new Error("No orgs found");
    }

    const group = await apiClient.createGroup({
        body: {
            name: projectName,
            orgId,
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

/**
 * Poll cluster state until `check` returns true or a timeout is reached.
 * Transient errors (e.g. a 404 right after creation) are treated as
 * "condition not met" and polling continues.
 */
export async function waitForClusterState(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string,
    check: (cluster: ClusterDescription20240805) => boolean | Promise<boolean>,
    pollingInterval: number = 1000,
    maxPollingIterations: number = 300
): Promise<void> {
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
            consecutiveErrors++;
            if (consecutiveErrors % 10 === 1) {
                console.log(
                    `waitForClusterState: getCluster failed ${consecutiveErrors} time(s), continuing to poll:`,
                    error
                );
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

/**
 * Wait until the named cluster is fully deleted (up to `maxIterations` polls).
 * A teardown timeout is tolerated (logged, not thrown) — the project deletion
 * step below is the second safety net.
 */
export async function waitForClusterDeletion(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string,
    maxIterations: number = 600
): Promise<void> {
    for (let i = 0; i < maxIterations; i++) {
        try {
            await apiClient.getCluster({
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
    // A teardown timeout should not fail the suite; deleteGroupWithRetry is the
    // second safety net.
    console.log(`Timed out waiting for cluster '${clusterName}' to be deleted after ${maxIterations} attempts`);
}

/**
 * Polls until the named streams workspace is readable (up to `maxIterations`
 * seconds); throws on timeout.
 */
export async function waitForStreamWorkspaceReadiness(
    apiClient: ApiClient,
    projectId: string,
    workspaceName: string,
    maxIterations: number = 120
): Promise<void> {
    for (let i = 0; i < maxIterations; i++) {
        try {
            const ws = await apiClient.getStreamWorkspace({
                params: {
                    path: { groupId: projectId, tenantName: workspaceName },
                },
            });
            if (ws?.name === workspaceName) {
                return;
            }
        } catch {
            // Workspace not ready yet
        }
        await sleep(1000);
    }
    throw new Error(
        `Workspace readiness timeout: '${workspaceName}' did not become readable within ${maxIterations} seconds`
    );
}

/**
 * Deletes every streams workspace in a project and waits for each to be gone
 * (up to 120s each). Errors are logged, never thrown — streams may not be
 * enabled on the project.
 */
export async function deleteStreamWorkspacesAndWait(apiClient: ApiClient, projectId: string): Promise<void> {
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

/**
 * Deletes every cluster in a project and waits until none remain (up to
 * 60 iterations x 10s = 10 min). Timeout is logged, not thrown.
 */
export async function deleteAllClustersAndWait(apiClient: ApiClient, projectId: string): Promise<void> {
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

/**
 * Deletes the named cluster (locating it in the project listing first) and
 * waits for termination. Delete errors are logged, not thrown.
 */
export async function deleteClusterAndWait(
    apiClient: ApiClient,
    projectId: string,
    clusterName: string
): Promise<void> {
    const clusters = await apiClient.listClusters({
        params: {
            path: {
                groupId: projectId,
            },
        },
    });
    const cluster = clusters.results?.find((c) => c.name === clusterName);
    if (cluster?.name) {
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
    await waitForClusterDeletion(apiClient, projectId, clusterName);
}

/**
 * Deletes a project, retrying on 409
 * (CANNOT_CLOSE_GROUP_ACTIVE_ATLAS_CLUSTERS) while Atlas is still terminating
 * clusters asynchronously. Non-conflict errors are rethrown.
 */
export async function deleteGroupWithRetry(apiClient: ApiClient, projectId: string): Promise<void> {
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
