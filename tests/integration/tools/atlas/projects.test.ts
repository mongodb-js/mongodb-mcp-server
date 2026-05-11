import { ObjectId } from "mongodb";
import { assertApiClientIsAvailable, describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined, getDataFromUntrustedContent, getResponseElements } from "../../helpers.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describeWithAtlas("projects", (integration) => {
    const projectsToCleanup: string[] = [];

    afterAll(async () => {
        const session = integration.mcpServer().session;
        assertApiClientIsAvailable(session);
        const apiClient = session.apiClient;
        const projects =
            (await apiClient.listGroups()).results?.filter((project) => projectsToCleanup.includes(project.name)) || [];

        for (const project of projects) {
            await session.apiClient.deleteGroup({
                params: {
                    path: {
                        groupId: project.id || "",
                    },
                },
            });
        }
    });

    describe("atlas-create-project", () => {
        it("should have correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const createProject = tools.find((tool) => tool.name === "atlas-create-project");
            expectDefined(createProject);
            expect(createProject.inputSchema.type).toBe("object");
            expectDefined(createProject.inputSchema.properties);
            expect(createProject.inputSchema.properties).toHaveProperty("projectName");
            expect(createProject.inputSchema.properties).toHaveProperty("organizationId");
        });

        it("should create a project", async () => {
            const projName = `testProj-${new ObjectId().toString()}`;
            projectsToCleanup.push(projName);

            const response = await integration.mcpClient().callTool({
                name: "atlas-create-project",
                arguments: { projectName: projName },
            });

            const elements = getResponseElements(response);
            expect(elements).toHaveLength(1);
            expect(elements[0]?.text).toContain(projName);
        });
    });

    describe("atlas-list-projects", () => {
        let projName: string;
        let orgId: string;
        beforeAll(async () => {
            projName = `testProj-${new ObjectId().toString()}`;
            projectsToCleanup.push(projName);

            const session = integration.mcpServer().session;
            assertApiClientIsAvailable(session);
            const apiClient = session.apiClient;
            const orgs = await apiClient.listOrgs();
            orgId = (orgs.results && orgs.results[0]?.id) ?? "";

            await integration.mcpClient().callTool({
                name: "atlas-create-project",
                arguments: { projectName: projName, organizationId: orgId },
            });
        });

        it("should have correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const listProjects = tools.find((tool) => tool.name === "atlas-list-projects");
            expectDefined(listProjects);
            expect(listProjects.inputSchema.type).toBe("object");
            expectDefined(listProjects.inputSchema.properties);
            expect(listProjects.inputSchema.properties).toHaveProperty("orgId");
        });

        describe("with orgId filter", () => {
            it("returns projects only for that org", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-list-projects",
                    arguments: {
                        orgId,
                    },
                });

                const elements = getResponseElements(response);
                expect(elements).toHaveLength(2);
                expect(elements[1]?.text).toContain("<untrusted-user-data-");
                expect(elements[1]?.text).toContain(projName);
                const data = JSON.parse(getDataFromUntrustedContent(elements[1]?.text ?? "")) as {
                    name: string;
                    orgId: string;
                }[];
                expect(data.length).toBeGreaterThan(0);
                expect(data.every((proj) => proj.orgId === orgId)).toBe(true);
                expect(data.find((proj) => proj.name === projName)).toBeDefined();

                expect(elements[0]?.text).toBe(`Found ${data.length} projects`);
            });
        });

        describe("without orgId filter", () => {
            it("returns projects for all orgs", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-list-projects",
                    arguments: {},
                });

                const elements = getResponseElements(response);
                expect(elements).toHaveLength(2);
                expect(elements[1]?.text).toContain("<untrusted-user-data-");
                expect(elements[1]?.text).toContain(projName);
                const data = JSON.parse(getDataFromUntrustedContent(elements[1]?.text ?? "")) as {
                    name: string;
                    orgId: string;
                }[];
                expect(data.length).toBeGreaterThan(0);
                expect(data.find((proj) => proj.name === projName && proj.orgId === orgId)).toBeDefined();

                expect(elements[0]?.text).toBe(`Found ${data.length} projects`);
            });
        });
    });
});
