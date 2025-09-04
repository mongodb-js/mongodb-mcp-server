import { describeWithAtlas, withProject, randomId } from "./atlasHelpers.js";
import { expectDefined, getResponseElements } from "../../helpers.js";
import { ApiClientError } from "../../../../src/common/atlas/apiClientError.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Keychain } from "../../../../src/common/keychain.js";

describeWithAtlas("db users", (integration) => {
    withProject(integration, ({ getProjectId }) => {
        let userName: string;
        beforeEach(() => {
            userName = "testuser-" + randomId;
        });

        const createUserWithMCP = async (password?: string): Promise<unknown> => {
            return await integration.mcpClient().callTool({
                name: "atlas-create-db-user",
                arguments: {
                    projectId: getProjectId(),
                    username: userName,
                    password,
                    roles: [
                        {
                            roleName: "readWrite",
                            databaseName: "admin",
                        },
                    ],
                },
            });
        };

        afterEach(async () => {
            const projectId = getProjectId();
            if (!projectId) {
                // projectId may be empty if beforeAll failed
                return;
            }

            try {
                await integration.mcpServer().session.apiClient.deleteDatabaseUser({
                    params: {
                        path: {
                            groupId: projectId,
                            username: userName,
                            databaseName: "admin",
                        },
                    },
                });
            } catch (error) {
                // Ignore 404 errors when deleting the user
                if (!(error instanceof ApiClientError) || error.response?.status !== 404) {
                    throw error;
                }
            }
        });

        describe("atlas-create-db-user", () => {
            beforeEach(() => {
                Keychain.root.clearAllSecrets();
            });

            afterEach(() => {
                Keychain.root.clearAllSecrets();
            });

            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const createDbUser = tools.find((tool) => tool.name === "atlas-create-db-user");
                expectDefined(createDbUser);
                expect(createDbUser.inputSchema.type).toBe("object");
                expectDefined(createDbUser.inputSchema.properties);
                expect(createDbUser.inputSchema.properties).toHaveProperty("projectId");
                expect(createDbUser.inputSchema.properties).toHaveProperty("username");
                expect(createDbUser.inputSchema.properties).toHaveProperty("password");
                expect(createDbUser.inputSchema.properties).toHaveProperty("roles");
                expect(createDbUser.inputSchema.properties).toHaveProperty("clusters");
            });

            it("should create a database user with supplied password", async () => {
                const response = await createUserWithMCP("testpassword");

                const elements = getResponseElements(response);
                expect(elements).toHaveLength(1);
                expect(elements[0]?.text).toContain("created successfully");
                expect(elements[0]?.text).toContain(userName);
                expect(elements[0]?.text).not.toContain("testpassword");

                expect(integration.mcpServer().session.keychain.allSecrets).toContainEqual({
                    value: userName,
                    kind: "user",
                });

                expect(integration.mcpServer().session.keychain.allSecrets).toContainEqual({
                    value: "testpassword",
                    kind: "password",
                });
            });

            it("should create a database user with generated password", async () => {
                const response = await createUserWithMCP();
                const elements = getResponseElements(response);
                expect(elements).toHaveLength(1);
                expect(elements[0]?.text).toContain("created successfully");
                expect(elements[0]?.text).toContain(userName);
                expect(elements[0]?.text).toContain("with password: `");

                const passwordStart = elements[0]?.text.lastIndexOf(":") ?? -1;
                const passwordEnd = elements[0]?.text.length ?? 1 - 1;

                const password = elements[0]?.text
                    .substring(passwordStart + 1, passwordEnd - 1)
                    .replace(/`/g, "")
                    .trim();

                expect(integration.mcpServer().session.keychain.allSecrets).toContainEqual({
                    value: userName,
                    kind: "user",
                });

                expect(integration.mcpServer().session.keychain.allSecrets).toContainEqual({
                    value: password,
                    kind: "password",
                });
            });

            it("should add current IP to access list when creating a database user", async () => {
                const projectId = getProjectId();
                const session = integration.mcpServer().session;
                const ipInfo = await session.apiClient.getIpInfo();
                await createUserWithMCP();
                const accessList = await session.apiClient.listProjectIpAccessLists({
                    params: { path: { groupId: projectId } },
                });
                const found = accessList.results?.some((entry) => entry.ipAddress === ipInfo.currentIpv4Address);
                expect(found).toBe(true);
            });
        });
        describe("atlas-list-db-users", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const listDbUsers = tools.find((tool) => tool.name === "atlas-list-db-users");
                expectDefined(listDbUsers);
                expect(listDbUsers.inputSchema.type).toBe("object");
                expectDefined(listDbUsers.inputSchema.properties);
                expect(listDbUsers.inputSchema.properties).toHaveProperty("projectId");
            });

            it("returns database users by project", async () => {
                const projectId = getProjectId();

                await createUserWithMCP();

                const response = await integration
                    .mcpClient()
                    .callTool({ name: "atlas-list-db-users", arguments: { projectId } });

                const elements = getResponseElements(response);
                expect(elements).toHaveLength(2);
                expect(elements[0]?.text).toContain("Found 1 database users in project");
                expect(elements[1]?.text).toContain("<untrusted-user-data-");
                expect(elements[1]?.text).toContain(userName);
            });
        });
    });
});
