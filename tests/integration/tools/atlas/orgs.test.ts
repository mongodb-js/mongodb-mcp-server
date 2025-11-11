import { expectDefined, getResponseContent } from "../../helpers.js";
import { describeWithAtlas, withCredentials } from "./atlasHelpers.js";
import { describe, expect, it } from "vitest";

describeWithAtlas("orgs", (integration) => {
    withCredentials(integration, () => {
        describe("atlas-list-orgs", () => {
            it("should have correct metadata", async () => {
                const { tools } = await integration.mcpClient().listTools();
                const listOrgs = tools.find((tool) => tool.name === "atlas-list-orgs");
                expectDefined(listOrgs);
            });

            it("returns org names", async () => {
                const response = await integration.mcpClient().callTool({ name: "atlas-list-orgs", arguments: {} });
                const content = getResponseContent(response.content);
                expect(content).toContain("Found 1 organizations");
                expect(content).toContain("<untrusted-user-data-");
                expect(content).toContain("MongoDB MCP Test");
            });
        });
    });
});
