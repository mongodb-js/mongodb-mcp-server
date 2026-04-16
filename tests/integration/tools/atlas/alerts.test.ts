import { expectDefined, getResponseContent } from "../../helpers.js";
import { describeWithAtlas, withProject } from "./atlasHelpers.js";
import { expect, it } from "vitest";

describeWithAtlas("atlas-list-alerts", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listAlerts = tools.find((tool) => tool.name === "atlas-list-alerts");
        expectDefined(listAlerts);
        expect(listAlerts.inputSchema.type).toBe("object");
        expectDefined(listAlerts.inputSchema.properties);
        expect(listAlerts.inputSchema.properties).toHaveProperty("projectId");
        expect(listAlerts.inputSchema.properties).toHaveProperty("status");
        expect(listAlerts.inputSchema.properties).toHaveProperty("limit");
        expect(listAlerts.inputSchema.properties).toHaveProperty("pageNum");
    });

    withProject(integration, ({ getProjectId }) => {
        it("returns alerts in JSON format", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-list-alerts",
                arguments: { projectId: getProjectId() },
            });

            const content = getResponseContent(response.content);
            if (content.includes("Found")) {
                expect(content).toContain("<untrusted-user-data-");
                expect(content).toContain(getProjectId());
            } else {
                expect(content).toContain("No alerts with status");
            }
        });
    });
});
