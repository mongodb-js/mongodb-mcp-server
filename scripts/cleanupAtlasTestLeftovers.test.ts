import type { Group, AtlasOrganization } from "../src/common/atlas/openapi.js";
import { ApiClient } from "../src/common/atlas/apiClient.js";
import { ConsoleLogger } from "../src/common/logger.js";
import { Keychain } from "../src/lib.js";
import { describe, it } from "vitest";

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
            try {
                await client.deleteCluster({
                    params: { path: { groupId: projectId || "", clusterName: cluster.name || "" } },
                });
            } catch (error) {
                errors.push(`Failed to delete cluster ${cluster.name} in project ${projectId}: ${String(error)}`);
            }
        })
    );

    return errors;
}

async function main(): Promise<void> {
    const apiClient = new ApiClient(
        {
            baseUrl: process.env.MDB_MCP_API_BASE_URL || "https://cloud-dev.mongodb.com",
            credentials: {
                clientId: process.env.MDB_MCP_API_CLIENT_ID || "",
                clientSecret: process.env.MDB_MCP_API_CLIENT_SECRET || "",
            },
        },
        new ConsoleLogger(Keychain.root)
    );

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

    for (const project of testProjects) {
        console.log(`Cleaning up project: ${project.name} (${project.id})`);
        if (!project.id) {
            console.warn(`Skipping project with missing ID: ${project.name}`);
            continue;
        }

        // Try to delete all clusters first
        const clusterErrors = await deleteAllClustersOnStaleProject(apiClient, project.id);
        allErrors.push(...clusterErrors);

        // Try to delete the project
        try {
            await apiClient.deleteGroup({
                params: {
                    path: {
                        groupId: project.id,
                    },
                },
            });
            console.log(`Deleted project: ${project.name} (${project.id})`);
        } catch (error) {
            const errorStr = String(error);
            const errorMessage = `Failed to delete project ${project.name} (${project.id}): ${errorStr}`;
            console.error(errorMessage);
            allErrors.push(errorMessage);
        }
    }

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
