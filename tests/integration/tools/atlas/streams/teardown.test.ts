import { getResponseContent } from "../../../helpers.js";
import { describeWithStreams, withWorkspace, randomId } from "../atlasHelpers.js";
import { beforeAll, describe, expect, it } from "vitest";

describeWithStreams("atlas-streams-teardown", (integration) => {
    describe("tool registration", () => {
        it("registers atlas-streams-teardown with correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-streams-teardown");
            expect(tool).toBeDefined();
            expect(tool!.inputSchema.type).toBe("object");
            expect(tool!.inputSchema.properties).toBeDefined();
            expect(tool!.inputSchema.properties).toHaveProperty("projectId");
            expect(tool!.inputSchema.properties).toHaveProperty("resource");
        });
    });

    withWorkspace(integration, ({ getProjectId, getWorkspaceName }) => {
        describe("connection deletion", () => {
            const teardownConnName = `teardownconn${randomId().slice(0, 8)}`;

            beforeAll(async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-build",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        connectionName: teardownConnName,
                        connectionType: "Https",
                        connectionConfig: {
                            url: "https://httpbin.org/post",
                        },
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Failed to create teardown connection: ${content}`).toBeFalsy();
            }, 30_000);

            it("deletes connection via teardown tool", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "atlas-streams-teardown",
                    arguments: {
                        projectId: getProjectId(),
                        resource: "connection",
                        workspaceName: getWorkspaceName(),
                        resourceName: teardownConnName,
                    },
                });
                const content = getResponseContent(response.content);
                expect(response.isError, `Unexpected error: ${content}`).toBeFalsy();
                expect(content).toContain("deletion initiated");
            }, 30_000);
        });

        // TODO: Add integration tests requiring external infrastructure:
        // - PrivateLink deletion (requires PrivateLink infrastructure)
        // - Peering deletion (requires VPC peering setup)
    });
});
