import { ObjectId } from "mongodb";
import { ApiClientError } from "@mongodb-js/mcp-atlas-api-client";
import type { ApiClient, ClusterDescription20240805, Group } from "@mongodb-js/mcp-atlas-api-client";

/**
 * A shared Atlas Streams test fixture (project + streams workspace + free-tier
 * cluster), provisioned once per test run by `streamsGlobalSetup.ts` and
 * consumed by every streams test file via `inject("atlasStreamsWorkspace")`.
 */
export interface StreamsWorkspaceFixture {
    projectId: string;
    workspaceName: string;
    clusterName: string;
    clusterConnectionName: string;
}

// Augment vitest's ProvidedContext so that `inject("atlasStreamsWorkspace")`
// is strongly typed in the test files.
declare module "vitest" {
    interface ProvidedContext {
        atlasStreamsWorkspace?: StreamsWorkspaceFixture;
    }
}

export function randomId(): string {
    return new ObjectId().toString();
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createGroup(apiClient: ApiClient): Promise<Group & Required<Pick<Group, "id">>> {
    // The streams fixture owns its own dedicated project, created in the pinned
    // test org (DEV_ATLAS_MCP_ORG_ID) when provided, otherwise the first org
    // returned by the API (with the test credentials this is the single
    // "MongoDB MCP Test" org the hourly cleanup job scans).
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

async function waitForWorkspaceReadiness(
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
 * Provision a project + streams workspace + free-tier (M0) cluster + the two
 * connections the streams tests rely on (`sample_stream_solar` Sample and a
 * `Cluster` connection backed by the M0). Waits for everything to be ready.
 *
 * If any step fails, best-effort teardown of the already-created project is
 * attempted before the error is rethrown, so a failed run does not leak a
 * project into the org.
 */
export async function provisionStreamsWorkspace(apiClient: ApiClient): Promise<StreamsWorkspaceFixture> {
    const workspaceName: string = `testws${randomId().slice(0, 12)}`;
    const clusterName: string = `testcluster${randomId().slice(0, 8)}`;
    const clusterConnectionName: string = `clusterconn${randomId().slice(0, 8)}`;

    let projectId: string = "";
    try {
        const group = await createGroup(apiClient);
        projectId = group.id;

        // Create workspace and free-tier cluster in parallel
        await Promise.all([
            apiClient.createStreamWorkspace({
                params: { path: { groupId: projectId } },
                body: {
                    name: workspaceName,
                    dataProcessRegion: {
                        cloudProvider: "AWS",
                        region: "VIRGINIA_USA",
                    },
                    streamConfig: {
                        tier: "SP10",
                    },
                } as never,
            }),
            apiClient.createCluster({
                params: { path: { groupId: projectId } },
                body: {
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
                } as unknown as ClusterDescription20240805,
            }),
        ]);

        // Wait for workspace readiness (up to 120s)
        await waitForWorkspaceReadiness(apiClient, projectId, workspaceName);

        // Create a Sample connection for tests
        await apiClient.createStreamConnection({
            params: { path: { groupId: projectId, tenantName: workspaceName } },
            body: {
                name: "sample_stream_solar",
                type: "Sample",
            } as never,
        });

        // Wait for the cluster to become IDLE before creating the Cluster connection.
        // M0 provisioning on cloud-dev is slow and non-deterministic (observed to
        // exceed 10 minutes), so allow up to 20 minutes (10s x 120).
        await waitForClusterState(
            apiClient,
            projectId,
            clusterName,
            (cluster) => {
                return cluster.stateName === "IDLE";
            },
            10_000,
            120
        );

        // Create a Cluster connection in the workspace for processor tests
        await apiClient.createStreamConnection({
            params: { path: { groupId: projectId, tenantName: workspaceName } },
            body: {
                name: clusterConnectionName,
                type: "Cluster",
                clusterName,
                dbRoleToExecute: {
                    role: "readWriteAnyDatabase",
                    type: "BUILT_IN",
                },
            } as never,
        });

        return { projectId, workspaceName, clusterName, clusterConnectionName };
    } catch (error) {
        // Do not leak a partially-provisioned project: best-effort teardown
        // before rethrowing so the run fails loudly.
        if (projectId) {
            console.log("Streams workspace provisioning failed; attempting partial cleanup.");
            try {
                await teardownStreamsWorkspace(apiClient, {
                    projectId,
                    workspaceName,
                    clusterName,
                    clusterConnectionName,
                });
            } catch (cleanupError) {
                console.log("Partial cleanup after provisioning failure also failed:", cleanupError);
            }
        }
        throw error;
    }
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
    // A teardown timeout should not fail the suite; teardownStreamsWorkspace's
    // project deletion with 409 retry is the second safety net.
    console.log(`Timed out waiting for cluster '${clusterName}' to be deleted after ${maxIterations} attempts`);
}

/**
 * Delete a shared streams fixture: workspace first (and wait for it to be
 * gone, because the cluster cannot be deleted while a workspace connection
 * references it), then clusters (and wait), then the project with 409 retry.
 * All steps are best-effort with clear logging.
 */
export async function teardownStreamsWorkspace(
    apiClient: ApiClient,
    fixture: StreamsWorkspaceFixture | undefined
): Promise<void> {
    if (!fixture?.projectId) {
        return;
    }
    const { projectId, clusterName } = fixture;

    // Phase 1: workspaces
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

    // Phase 2: clusters
    try {
        await deleteClusterAndWait(apiClient, projectId, clusterName);
    } catch (error) {
        console.log("Failed to clean up clusters:", error);
    }

    // Phase 3: project (with 409 retry in case Atlas is still terminating clusters)
    try {
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
    } catch (error) {
        console.log("Failed to delete group:", error);
    }
}

async function deleteClusterAndWait(apiClient: ApiClient, projectId: string, clusterName: string): Promise<void> {
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
