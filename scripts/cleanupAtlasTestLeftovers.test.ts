import type { Group, AtlasOrganization } from "../src/common/atlas/openapi.js";
import { ApiClient } from "../src/common/atlas/apiClient.js";
import { ConsoleLogger } from "../src/common/logger.js";
import { Keychain } from "../src/lib.js";
import { describe, it } from "vitest";

function isOlderThanADay(date: string): boolean {
    const oneDayInMs = 24 * 60 * 60 * 1000;
    const projectDate = new Date(date);
    const currentDate = new Date();
    return currentDate.getTime() - projectDate.getTime() > oneDayInMs;
}

async function findTestOrganization(client: ApiClient): Promise<AtlasOrganization> {
    const orgs = await client.listOrganizations();
    const testOrg = orgs?.results?.find((org) => org.name === "MongoDB MCP Test");

    if (!testOrg) {
        throw new Error('Test organization "MongoDB MCP Test" not found.');
    }

    return testOrg;
}

async function findAllTestProjects(client: ApiClient, orgId: string): Promise<Group[]> {
    const projects = await client.listOrganizationProjects({
        params: {
            path: {
                orgId,
            },
        },
    });

    const testProjects = projects?.results?.filter((proj) => proj.name.startsWith("testProj-")) || [];
    return testProjects.filter((proj) => isOlderThanADay(proj.created));
}

async function deleteAllClustersOnStaleProject(client: ApiClient, projectId: string): Promise<void> {
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
        allClusters.map((cluster) =>
            client.deleteCluster({ params: { path: { groupId: projectId || "", clusterName: cluster.name || "" } } })
        )
    );
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
    const testProjects = await findAllTestProjects(apiClient, testOrg.id || "");

    if (testProjects.length === 0) {
        console.log("No stale test projects found for cleanup.");
    }

    for (const project of testProjects) {
        console.log(`Cleaning up project: ${project.name} (${project.id})`);
        if (!project.id) {
            console.warn(`Skipping project with missing ID: ${project.name}`);
            continue;
        }

        await deleteAllClustersOnStaleProject(apiClient, project.id);
        await apiClient.deleteProject({
            params: {
                path: {
                    groupId: project.id,
                },
            },
        });
        console.log(`Deleted project: ${project.name} (${project.id})`);
    }

    return;
}

describe("Cleanup Atlas Test Leftovers", () => {
    it("should clean up stale test projects", async () => {
        await main();
    });
});
