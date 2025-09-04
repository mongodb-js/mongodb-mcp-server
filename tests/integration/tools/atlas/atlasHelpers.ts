import { ObjectId } from "mongodb";
import type { Group } from "../../../../src/common/atlas/openapi.js";
import type { ApiClient } from "../../../../src/common/atlas/apiClient.js";
import type { IntegrationTest } from "../../helpers.js";
import { setupIntegrationTest, defaultTestConfig, defaultDriverOptions } from "../../helpers.js";
import type { SuiteCollector } from "vitest";
import { afterAll, beforeAll, describe } from "vitest";

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
                apiClientId: process.env.MDB_MCP_API_CLIENT_ID,
                apiClientSecret: process.env.MDB_MCP_API_CLIENT_SECRET,
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
                const group = await createProject(apiClient);
                const ipInfo = await apiClient.getIpInfo();
                ipAddress = ipInfo.currentIpv4Address;
                projectId = group.id;
            } catch (error) {
                console.error("Failed to create project:", error);
                throw error;
            }
        });

        afterAll(async () => {
            const apiClient = integration.mcpServer().session.apiClient;
            if (projectId) {
                // projectId may be empty if beforeAll failed.
                await apiClient.deleteProject({
                    params: {
                        path: {
                            groupId: projectId,
                        },
                    },
                });
            }
        });

        const args = {
            getProjectId: (): string => projectId,
            getIpAddress: (): string => ipAddress,
        };

        fn(args);
    });
}

export function parseTable(text: string): Record<string, string>[] {
    const data = text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.split("|").map((cell) => cell.trim()));

    const headers = data[0];
    return data
        .filter((_, index) => index >= 2)
        .map((cells) => {
            const row: Record<string, string> = {};
            cells.forEach((cell, index) => {
                if (headers) {
                    row[headers[index] ?? ""] = cell;
                }
            });
            return row;
        });
}

export const randomId = new ObjectId().toString();

async function createProject(apiClient: ApiClient): Promise<Group & Required<Pick<Group, "id">>> {
    const projectName: string = `testProj-` + randomId;

    const orgs = await apiClient.listOrganizations();
    if (!orgs?.results?.length || !orgs.results[0]?.id) {
        throw new Error("No orgs found");
    }

    const group = await apiClient.createProject({
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
    await apiClient.createProjectIpAccessList({
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
