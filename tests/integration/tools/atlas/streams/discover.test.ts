import { expectDefined, getResponseContent } from "../../../helpers.js";
import { describeWithStreams, withWorkspace } from "../atlasHelpers.js";
import { describe, expect, it } from "vitest";

describeWithStreams("atlas-streams-discover", (integration) => {
    describe("tool registration", () => {
        it("registers atlas-streams-discover with correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-streams-discover");
            expectDefined(tool);
            expect(tool.inputSchema.type).toBe("object");
            expectDefined(tool.inputSchema.properties);
            expect(tool.inputSchema.properties).toHaveProperty("projectId");
            expect(tool.inputSchema.properties).toHaveProperty("action");
        });
    });

    withWorkspace(integration, ({ getProjectId, getWorkspaceName }) => {
        it("list-workspaces — returns workspace list", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-workspaces",
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("workspace(s)");
            expect(content).toContain(getWorkspaceName());
        });

        it("inspect-workspace — returns workspace details", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "inspect-workspace",
                    workspaceName: getWorkspaceName(),
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain(getWorkspaceName());
            expect(content).toContain("<untrusted-user-data-");
        });

        it("list-connections — includes sample_stream_solar", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-connections",
                    workspaceName: getWorkspaceName(),
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("connection(s)");
            expect(content).toContain("sample_stream_solar");
        });

        it("inspect-connection — returns connection details", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "inspect-connection",
                    workspaceName: getWorkspaceName(),
                    resourceName: "sample_stream_solar",
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("<untrusted-user-data-");
            expect(content).toContain("sample_stream_solar");
        });

        it("list-workspaces — detailed format includes dataProcessRegion", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-workspaces",
                    responseFormat: "detailed",
                },
            });
            const content = getResponseContent(response.content);
            expect(response.isError).toBeFalsy();
            expect(content).toContain("dataProcessRegion");
        });

        it("list-connections — detailed format includes full object", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-connections",
                    workspaceName: getWorkspaceName(),
                    responseFormat: "detailed",
                },
            });
            const content = getResponseContent(response.content);
            expect(response.isError).toBeFalsy();
            // Detailed format includes full connection objects, not just name/type/state
            expect(content).toContain("sample_stream_solar");
            expect(content).toContain("connection(s)");
        });

        it("list-processors — initially empty", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-processors",
                    workspaceName: getWorkspaceName(),
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("No processors found");
        });

        it("get-networking — returns networking section", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "get-networking",
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("PrivateLink");
        });

        it("get-logs — operational logs", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "get-logs",
                    workspaceName: getWorkspaceName(),
                    logType: "operational",
                },
            });
            expect(response.isError).toBeFalsy();
            const content = getResponseContent(response.content);
            // Any of these are valid code paths: logs returned, empty, or decompression issue
            expect(
                content.includes("logs for workspace") ||
                    content.includes("No logs available") ||
                    content.includes("Could not decompress")
            ).toBe(true);
        });

        it("get-logs — audit logs", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "get-logs",
                    workspaceName: getWorkspaceName(),
                    logType: "audit",
                },
            });
            expect(response.isError).toBeFalsy();
            const content = getResponseContent(response.content);
            expect(
                content.includes("logs for workspace") ||
                    content.includes("No logs available") ||
                    content.includes("Could not decompress")
            ).toBe(true);
        });

        it("list-all-processors — works across workspaces", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "list-all-processors",
                },
            });
            expect(response.isError).toBeFalsy();
        });

        it("find-processor — returns not-found for nonexistent", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "find-processor",
                    resourceName: "nonexistent-processor",
                },
            });
            const content = getResponseContent(response.content);
            expect(content).toContain("not found");
        });

        it("inspect-workspace — error without workspaceName", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "inspect-workspace",
                },
            });
            expect(response.isError).toBeTruthy();
            const content = getResponseContent(response.content);
            expect(content).toContain("workspaceName is required");
        });

        it("inspect-processor — error without resourceName", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "inspect-processor",
                    workspaceName: getWorkspaceName(),
                },
            });
            expect(response.isError).toBeTruthy();
            const content = getResponseContent(response.content);
            expect(content).toContain("resourceName is required");
        });

        it("inspect-connection — 404 for nonexistent connection", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-streams-discover",
                arguments: {
                    projectId: getProjectId(),
                    action: "inspect-connection",
                    workspaceName: getWorkspaceName(),
                    resourceName: "nonexistent_conn",
                },
            });
            expect(response.isError).toBeTruthy();
            const content = getResponseContent(response.content);
            expect(content).toContain("not found");
        });
    });
});
