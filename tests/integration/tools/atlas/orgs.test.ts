import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expectDefined } from "../../helpers.js";
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
            const response = (await integration
                .mcpClient()
                .callTool({ name: "atlas-list-orgs", arguments: {} })) as CallToolResult;
            expect(response.content).toBeInstanceOf(Array);
            expect(response.content).toHaveLength(1);
            const data = parseTable(response.content[0]?.text as string);
            expect(data).toHaveLength(1);
            expect(data[0]?.["Organization Name"]).toEqual("MongoDB MCP Test");
        });
    });
});
