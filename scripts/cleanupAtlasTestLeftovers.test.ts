import { ApiClient, type Group, type AtlasOrganization } from "@mongodb-js/mcp-atlas-api-client";
import { ConsoleLogger } from "@mongodb-js/mcp-logging";
import { Keychain } from "../src/lib.js";
import { describe, it } from "vitest";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOlderThanTwoHours(date: string): boolean {
    const twoHoursInMs = 2 * 60 * 60 * 1000;
    const projectDate = new Date(date);
    const currentDate = new Date();
    return currentDate.getTime() - projectDate.getTime() > twoHoursInMs;
}

async function findTestOrganization(client: ApiClient): Promise<AtlasOrganization> {
    const orgs = await client.listOrgs();
    const testOrg = orgs?.results?.find((org) => org.name === "MongoDB MCP Test");

    if (!testOrg) {
        throw new Error('Test organization "MongoDB MCP Test" not found.');
    }

    return testOrg;
}

async function findAllTestProjects(client: ApiClient, orgId: string): Promise<Group[]> {
    const projects = await client.getOrgGroups({
        params: {
            path: {
                orgId,
            },
        },
    });

    const testProjects = projects?.results?.filter((proj) => proj.name.startsWith("testProj-")) || [];
    return testProjects.filter((proj) => isOlderThanTwoHours(proj.created));
}

async function deleteAllWorkspacesOnStaleProject(client: ApiClient, projectId: string): Promise<string[]> {
    const errors: string[] = [];

    try {
        const workspaces = await client
            .listStreamWorkspaces({
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
            })
            .then((res) => res.results || []);

        await Promise.allSettled(
            workspaces.map(async (workspace) => {
                const name = workspace.name || "";
                try {
                    // Delete all processors first (auto-stops running ones)
                    try {
                        const processors = await client
                            .getStreamProcessors({
                                params: { path: { groupId: projectId, tenantName: name } },
                            })
                            .then((res) => res.results || []);
                        await Promise.allSettled(
                            processors.map((p) =>
                                client.deleteStreamProcessor({
                                    params: {
                                        path: {
                                            groupId: projectId,
                                            tenantName: name,
                                            processorName: p.name || "",
                                        },
                                    },
                                })
                            )
                        );
                    } catch {
                        // Ignore errors listing/deleting processors
                    }
                    await client.deleteStreamWorkspace({
                        params: {
                            path: { groupId: projectId, tenantName: name },
                        },
                    });
                    // Wait for workspace to be fully deleted (up to 120s)
                    for (let i = 0; i < 120; i++) {
                        try {
                            await client.getStreamWorkspace({
                                params: {
                                    path: { groupId: projectId, tenantName: name },
                                },
                            });
                            await sleep(1000);
                        } catch {
                            break;
                        }
                    }
                    console.log(`  Deleted workspace: ${name}`);
                } catch (error) {
                    errors.push(`Failed to delete workspace ${name} in project ${projectId}: ${String(error)}`);
                }
            })
        );
    } catch {
        // Project may not have streams enabled, ignore
    }

    return errors;
}

async function deleteAllClustersOnStaleProject(client: ApiClient, projectId: string): Promise<string[]> {
    const errors: string[] = [];

    const allClusters = await client
        .listClusters({
            params: {
                path: {
                    groupId: projectId || "",
                },
            },
        })
        .then((res) => res.results || []);

    await Promise.allSettled(
        allClusters.map(async (cluster) => {
            const name = cluster.name || "";
            try {
                await client.deleteCluster({
                    params: { path: { groupId: projectId || "", clusterName: name } },
                });
            } catch (error) {
                errors.push(`Failed to delete cluster ${name} in project ${projectId}: ${String(error)}`);
            }
        })
    );

    return errors;
}

async function main(): Promise<void> {
    const apiClient = new ApiClient({
        baseUrl: process.env.MDB_MCP_API_BASE_URL || "https://cloud-dev.mongodb.com",
        credentials: {
            clientId: process.env.MDB_MCP_API_CLIENT_ID || "",
            clientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "",
        },
        userAgent: "mongodb-mcp-test-cleanup",
        logger: new ConsoleLogger({ keychain: Keychain.root }),
    });

    const testOrg = await findTestOrganization(apiClient);
    if (!testOrg.id) {
        throw new Error("Test organization ID not found.");
    }

    const testProjects = await findAllTestProjects(apiClient, testOrg.id);
    if (testProjects.length === 0) {
        console.log("No stale test projects found for cleanup.");
        return;
    }

    const allErrors: string[] = [];

    const projectsWithIds = testProjects.filter((p): p is Group & { id: string } => !!p.id);

    // Phase 1: Delete all workspaces and clusters in parallel across all projects
    await Promise.allSettled(
        projectsWithIds.map(async (project) => {
            console.log(`Cleaning up project: ${project.name} (${project.id})`);
            const workspaceErrors = await deleteAllWorkspacesOnStaleProject(apiClient, project.id);
            allErrors.push(...workspaceErrors);
            const clusterErrors = await deleteAllClustersOnStaleProject(apiClient, project.id);
            allErrors.push(...clusterErrors);
        })
    );

    // Phase 2: Wait for clusters to terminate, then delete projects in parallel
    await Promise.allSettled(
        projectsWithIds.map(async (project) => {
            // Wait for clusters to be fully deleted (up to 300s)
            for (let i = 0; i < 300; i++) {
                try {
                    const remaining = await apiClient
                        .listClusters({ params: { path: { groupId: project.id } } })
                        .then((res) => res.results || []);
                    if (remaining.length === 0) {
                        break;
                    }
                    await sleep(1000);
                } catch {
                    break;
                }
            }
            try {
                await apiClient.deleteGroup({
                    params: { path: { groupId: project.id } },
                });
                console.log(`Deleted project: ${project.name} (${project.id})`);
            } catch (error) {
                const errorMessage = `Failed to delete project ${project.name} (${project.id}): ${String(error)}`;
                console.error(errorMessage);
                allErrors.push(errorMessage);
            }
        })
    );

    if (allErrors.length > 0) {
        const errorList = allErrors.map((err, i) => `${i + 1}. ${err}`).join("\n");
        const errorSummary = `Cleanup completed with ${allErrors.length} error(s):\n${errorList}`;
        throw new Error(errorSummary);
    }

    console.log("All stale test projects cleaned up successfully.");
}

describe("Cleanup Atlas Test Leftovers", () => {
    it("should clean up stale test projects", async () => {
        await main();
    });
});
