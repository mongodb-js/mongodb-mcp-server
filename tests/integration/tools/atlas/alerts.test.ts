import {
    getResponseElements,
    projectIdInvalidArgs,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../helpers.js";
import { parseTable, describeWithAtlas, withProject } from "./atlasHelpers.js";
import { expect, it, describe } from "vitest";

describeWithAtlas("atlas-list-alerts", (integration) => {
    describe("should have correct metadata and validate invalid arguments", () => {
        validateToolMetadata(integration, "atlas-list-alerts", "List MongoDB Atlas alerts", [
            {
                name: "projectId",
                type: "string",
                description: "Atlas project ID to list alerts for",
                required: true,
            },
        ]);

        validateThrowsForInvalidArguments(integration, "atlas-list-alerts", projectIdInvalidArgs);
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
