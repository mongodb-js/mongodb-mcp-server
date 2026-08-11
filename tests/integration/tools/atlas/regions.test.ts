import { describe, expect, it } from "vitest";
import { expectDefined } from "../../helpers.js";
import { describeWithAtlas } from "./atlasHelpers.js";

describeWithAtlas("regions", (integration) => {
    describe("atlas-get-regions", () => {
        it("should have correct metadata", async () => {
            const { tools } = await integration.mcpClient().listTools();
            const tool = tools.find((t) => t.name === "atlas-get-regions");

            expectDefined(tool);
            expect(tool.inputSchema.type).toBe("object");
            expectDefined(tool.inputSchema.properties);

            const properties = tool.inputSchema.properties;
            expect(properties).toHaveProperty("provider");

            const required = tool.inputSchema.required as string[];
            expect(required).toContain("provider");
        });
    });
});
