import { ObjectId } from "mongodb";
import type { Group } from "../../../../src/common/atlas/openapi.js";
import type { ApiClient } from "../../../../src/common/atlas/apiClient.js";
import type { IntegrationTest } from "../../helpers.js";
import { setupIntegrationTest, defaultTestConfig, defaultDriverOptions } from "../../helpers.js";
import type { SuiteCollector } from "vitest";
import { beforeAll, afterAll, describe } from "vitest";

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

        beforeAllWithRetry(async () => {
            const apiClient = integration.mcpServer().session.apiClient;
            const group = await createProject(apiClient);
            projectId = group.id;
        });

        afterAllWithRetry(async () => {
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
        };

        fn(args);
    });
}

export function beforeAllWithRetry(fixture: () => Promise<void>): void {
    beforeAll(async () => {
        const MAX_SETUP_ATTEMPTS = 10;
        const SETUP_BACKOFF_MS = 10;
        let lastError: Error | undefined = undefined;

        for (let attempt = 0; attempt < MAX_SETUP_ATTEMPTS; attempt++) {
            try {
                await fixture();
                lastError = undefined;
                break;
            } catch (error: unknown) {
                if (error instanceof Error) {
                    lastError = error;
                } else {
                    lastError = new Error(String(error));
                }

                console.error("beforeAll(attempt:", attempt, "):", error);
                await new Promise((resolve) => setTimeout(resolve, SETUP_BACKOFF_MS * attempt));
            }
        }

        if (lastError) {
            throw lastError;
        }
    });
}

export function afterAllWithRetry(fixture: () => Promise<void>): void {
    afterAll(async () => {
        const MAX_SETUP_ATTEMPTS = 10;
        const SETUP_BACKOFF_MS = 10;
        let lastError: Error | undefined = undefined;

        for (let attempt = 0; attempt < MAX_SETUP_ATTEMPTS; attempt++) {
            try {
                await fixture();
                lastError = undefined;
                break;
            } catch (error) {
                if (error instanceof Error) {
                    lastError = error;
                } else {
                    lastError = new Error(String(error));
                }
                console.error("afterAll(attempt:", attempt, "):", error);
                await new Promise((resolve) => setTimeout(resolve, SETUP_BACKOFF_MS * attempt));
            }
        }

        if (lastError) {
            throw lastError;
        }
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

    return group as Group & Required<Pick<Group, "id">>;
}
