import type { ApiClient, ClusterDescription20240805 } from "@mongodb-js/mcp-atlas-api-client";
import {
    createGroup,
    deleteClusterAndWait,
    deleteGroupWithRetry,
    deleteStreamWorkspacesAndWait,
    randomId,
    waitForClusterState,
    waitForStreamWorkspaceReadiness,
} from "./atlasProvisioning.js";

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
        await waitForStreamWorkspaceReadiness(apiClient, projectId, workspaceName);

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

    // Phase 1: workspaces must go first — the cluster cannot be deleted while a
    // workspace connection references it.
    await deleteStreamWorkspacesAndWait(apiClient, projectId);

    // Phase 2: clusters
    try {
        await deleteClusterAndWait(apiClient, projectId, clusterName);
    } catch (error) {
        console.log("Failed to clean up clusters:", error);
    }

    // Phase 3: project (with 409 retry in case Atlas is still terminating clusters)
    try {
        await deleteGroupWithRetry(apiClient, projectId);
    } catch (error) {
        console.log("Failed to delete group:", error);
    }
}
