import { expectDefined, getDataFromUntrustedContent, getResponseElements } from "../../helpers.js";
import { parseTable, describeWithAtlas } from "./atlasHelpers.js";
import { describe, expect, it } from "vitest";

describeWithAtlas("orgs", (integration) => {
    describe("atlas-list-orgs", () => {
        it("should have correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const listOrgs = tools.find((tool) => tool.name === "atlas-list-orgs");
            expectDefined(listOrgs);
        });

        it("returns org names", async () => {
            const response = await integration.mcpClient().callTool({ name: "atlas-list-orgs", arguments: {} });
            const elements = getResponseElements(response);
            expect(elements[0]?.text).toContain("Found 1 organizations");
            expect(elements[1]?.text).toContain("<untrusted-user-data-");
            const data = parseTable(getDataFromUntrustedContent(elements[1]?.text ?? ""));
            expect(data).toHaveLength(1);
            expect(data[0]?.["Organization Name"]).toEqual("MongoDB MCP Test");
        });
    });
});
