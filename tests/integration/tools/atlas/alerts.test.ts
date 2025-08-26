import { expectDefined, getResponseElements } from "../../helpers.js";
import { parseTable, describeWithAtlas, withProject } from "./atlasHelpers.js";
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
        it("returns alerts in table format", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-list-alerts",
                arguments: { projectId: getProjectId() },
            });

            const elements = getResponseElements(response.content);
            expect(elements).toHaveLength(1);

            const data = parseTable(elements[0]?.text ?? "");

            // Since we can't guarantee alerts will exist, we just verify the table structure
            if (data.length > 0) {
                const alert = data[0];
                expect(alert).toHaveProperty("Alert ID");
                expect(alert).toHaveProperty("Status");
                expect(alert).toHaveProperty("Created");
                expect(alert).toHaveProperty("Updated");
                expect(alert).toHaveProperty("Type");
                expect(alert).toHaveProperty("Comment");
            }
        });
    });
});
