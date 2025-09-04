import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
} from "../../helpers.js";
import { describe, expect, it } from "vitest";

describe("atlas-local-list-deployments", () => {
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions
    );

    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listDeployments = tools.find((tool) => tool.name === "atlas-local-list-deployments");
        expectDefined(listDeployments);
        expect(listDeployments.inputSchema.type).toBe("object");
        expectDefined(listDeployments.inputSchema.properties);
        expect(listDeployments.inputSchema.properties).toEqual({});
    });

    it("should not crash when calling the tool", async () => {
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const elements = getResponseElements(response.content);
        expect(elements).toHaveLength(2);
        expect(elements[0]?.text).toMatch(/Found \d+ deployments/);
        expect(elements[1]?.text).toContain(
            "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\n"
        );
    });
});
