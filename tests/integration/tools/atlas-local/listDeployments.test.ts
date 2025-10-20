import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
} from "../../helpers.js";
import { describe, expect, it } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Docker is not available on macOS in GitHub Actions
// That's why we skip the tests on macOS in GitHub Actions
describe("atlas-local-list-deployments", () => {
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions
    );

    it.skipIf(isMacOSInGitHubActions)("should have the atlas-local-list-deployments tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listDeployments = tools.find((tool) => tool.name === "atlas-local-list-deployments");
        expectDefined(listDeployments);
    });

    it.skipIf(!isMacOSInGitHubActions)(
        "[MacOS in GitHub Actions] should not have the atlas-local-list-deployments tool",
        async () => {
            const { tools } = await integration.mcpClient().listTools();
            const listDeployments = tools.find((tool) => tool.name === "atlas-local-list-deployments");
            expect(listDeployments).toBeUndefined();
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listDeployments = tools.find((tool) => tool.name === "atlas-local-list-deployments");
        expectDefined(listDeployments);
        expect(listDeployments.inputSchema.type).toBe("object");
        expectDefined(listDeployments.inputSchema.properties);
        expect(listDeployments.inputSchema.properties).toEqual({});
    });

    it.skipIf(isMacOSInGitHubActions)("should not crash when calling the tool", async () => {
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const elements = getResponseElements(response.content);
        expect(elements.length).toBeGreaterThanOrEqual(1);

        if (elements.length === 1) {
            expect(elements[0]?.text).toContain("No deployments found.");
        }

        if (elements.length > 1) {
            expect(elements[0]?.text).toMatch(/Found \d+ deployments/);
            expect(elements[1]?.text).toContain(
                "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\n"
            );
        }
    });
});
