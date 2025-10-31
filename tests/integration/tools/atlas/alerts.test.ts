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
    });

    withProject(integration, ({ getProjectId }) => {
        it("returns alerts in JSON format", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-list-alerts",
                arguments: { projectId: getProjectId() },
            });

            const content = getResponseContent(response.content);
            // check that there are alerts or no alerts
            if (content.includes("Found alerts in project")) {
                expect(content).toContain("<untrusted-user-data-");
                // expect projectId in the content
                expect(content).toContain(getProjectId());
            } else {
                expect(content).toContain("No alerts found");
            }
        });
    });
});
