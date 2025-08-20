import { ObjectId } from "mongodb";
import { parseTable, describeWithAtlas } from "./atlasHelpers.js";
import { expectDefined, getDataFromUntrustedContent, getResponseElements } from "../../helpers.js";
import { afterAll, describe, expect, it } from "vitest";

const randomId = new ObjectId().toString();

describeWithAtlas("projects", (integration) => {
    const projName = "testProj-" + randomId;

    afterAll(async () => {
        const session = integration.mcpServer().session;

        const projects = await session.apiClient.listProjects();
        for (const project of projects?.results || []) {
            if (project.name === projName) {
                await session.apiClient.deleteProject({
                    params: {
                        path: {
                            groupId: project.id || "",
                        },
                    },
                });
                break;
            }
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
        it("should have correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const listProjects = tools.find((tool) => tool.name === "atlas-list-projects");
            expectDefined(listProjects);
            expect(listProjects.inputSchema.type).toBe("object");
            expectDefined(listProjects.inputSchema.properties);
            expect(listProjects.inputSchema.properties).toHaveProperty("orgId");
        });

        it("returns project names", async () => {
            const response = await integration.mcpClient().callTool({ name: "atlas-list-projects", arguments: {} });
            const elements = getResponseElements(response);
            expect(elements).toHaveLength(2);
            expect(elements[0]?.text).toMatch(/Found \d+ projects/);
            expect(elements[1]?.text).toContain("<untrusted-user-data-");
            expect(elements[1]?.text).toContain(projName);
            const data = parseTable(getDataFromUntrustedContent(elements[1]?.text ?? ""));
            expect(data.length).toBeGreaterThan(0);
            let found = false;
            for (const project of data) {
                if (project["Project Name"] === projName) {
                    found = true;
                }
            }
            expect(found).toBe(true);
        });
    });
});
