import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
    waitUntilAtlasLocalClientIsSet,
} from "../../helpers.js";
import { describe, expect, it } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Docker is not available on macOS in GitHub Actions
// That's why we skip the tests on macOS in GitHub Actions
describe("atlas-local-delete-deployment", () => {
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions
    );

    it.skipIf(isMacOSInGitHubActions)("should have the atlas-local-delete-deployment tool", async ({ signal }) => {
        await waitUntilAtlasLocalClientIsSet(integration.mcpServer(), signal);

        const { tools } = await integration.mcpClient().listTools();
        const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
        expectDefined(deleteDeployment);
    });

    it.skipIf(!isMacOSInGitHubActions)(
        "[MacOS in GitHub Actions] should not have the atlas-local-delete-deployment tool",
        async ({ signal }) => {
            // This should throw an error because the client is not set within the timeout of 5 seconds (default)
            await expect(waitUntilAtlasLocalClientIsSet(integration.mcpServer(), signal)).rejects.toThrow();

            const { tools } = await integration.mcpClient().listTools();
            const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
            expect(deleteDeployment).toBeUndefined();
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should have correct metadata", async ({ signal }) => {
        await waitUntilAtlasLocalClientIsSet(integration.mcpServer(), signal);
        const { tools } = await integration.mcpClient().listTools();
        const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
        expectDefined(deleteDeployment);
        expect(deleteDeployment.inputSchema.type).toBe("object");
        expectDefined(deleteDeployment.inputSchema.properties);
        expect(deleteDeployment.inputSchema.properties).toHaveProperty("deploymentName");
    });

    it.skipIf(isMacOSInGitHubActions)(
        "should return 'no such container' error when deployment to delete does not exist",
        async ({ signal }) => {
            await waitUntilAtlasLocalClientIsSet(integration.mcpServer(), signal);
            const deploymentName = "non-existent";

            const response = await integration.mcpClient().callTool({
                name: "atlas-local-delete-deployment",
                arguments: { deploymentName },
            });
            const elements = getResponseElements(response.content);
            expect(elements.length).toBeGreaterThanOrEqual(1);
            expect(elements[0]?.text).toContain(
                `The Atlas Local deployment "${deploymentName}" was not found. Please check the deployment name or use "atlas-local-list-deployments" to see available deployments.`
            );
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should delete a deployment when calling the tool", async ({ signal }) => {
        await waitUntilAtlasLocalClientIsSet(integration.mcpServer(), signal);
        // Create a deployment
        const deploymentName = `test-deployment-${Date.now()}`;
        await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName },
        });

        // Check that deployment exists before deletion
        const beforeResponse = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const beforeElements = getResponseElements(beforeResponse.content);
        expect(beforeElements.length).toBeGreaterThanOrEqual(1);
        expect(beforeElements[1]?.text ?? "").toContain(deploymentName);

        // Delete the deployment
        await integration.mcpClient().callTool({
            name: "atlas-local-delete-deployment",
            arguments: { deploymentName },
        });

        // Count the number of deployments after deleting the deployment
        const afterResponse = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const afterElements = getResponseElements(afterResponse.content);
        expect(afterElements[1]?.text ?? "").not.toContain(deploymentName);
    });
});
