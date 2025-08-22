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
            }),
            () => defaultDriverOptions
        );
        fn(integration);
    });
}

interface ProjectTestArgs {
    getProjectId: () => string;
}

type ProjectTestFunction = (args: ProjectTestArgs) => void;

export function withProject(integration: IntegrationTest, fn: ProjectTestFunction): SuiteCollector<object> {
    return describe("with project", () => {
        let projectId: string = "";

        beforeAll(async () => {
            const apiClient = integration.mcpServer().session.apiClient;

            try {
                const group = await createProject(apiClient);
                projectId = group.id || "";
            } catch (error) {
                console.error("Failed to create project:", error);
                throw error;
            }
        });

        afterAll(async () => {
            const apiClient = integration.mcpServer().session.apiClient;

            await apiClient.deleteProject({
                params: {
                    path: {
                        groupId: projectId,
                    },
                },
            });
        });

        const args = {
            getProjectId: (): string => projectId,
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

async function createProject(apiClient: ApiClient): Promise<Group> {
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

    return group;
}
