import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
    waitUntilMcpClientIsSet,
} from "../../helpers.js";
import { describe, expect, it } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Docker is not available on macOS in GitHub Actions
// That's why we skip the tests on macOS in GitHub Actions
describe("atlas-local-connect-deployment", () => {
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions
    );

    it.skipIf(isMacOSInGitHubActions)("should have the atlas-local-connect-deployment tool", async ({ signal }) => {
        await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

        const { tools } = await integration.mcpClient().listTools();
        const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
        expectDefined(connectDeployment);
    });

    it.skipIf(!isMacOSInGitHubActions)(
        "[MacOS in GitHub Actions] should not have the atlas-local-connect-deployment tool",
        async ({ signal }) => {
            // This should throw an error because the client is not set within the timeout of 5 seconds (default)
            await expect(waitUntilMcpClientIsSet(integration.mcpServer(), signal)).rejects.toThrow();

            const { tools } = await integration.mcpClient().listTools();
            const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
            expect(connectDeployment).toBeUndefined();
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should have correct metadata", async ({ signal }) => {
        await waitUntilMcpClientIsSet(integration.mcpServer(), signal);
        const { tools } = await integration.mcpClient().listTools();
        const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
        expectDefined(connectDeployment);
        expect(connectDeployment.inputSchema.type).toBe("object");
        expectDefined(connectDeployment.inputSchema.properties);
        expect(connectDeployment.inputSchema.properties).toHaveProperty("deploymentIdOrName");
    });

    it.skipIf(isMacOSInGitHubActions)(
        "should return 'no such container' error when connecting to non-existent deployment",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

            const response = await integration.mcpClient().callTool({
                name: "atlas-local-connect-deployment",
                arguments: { deploymentIdOrName: "non-existent" },
            });
            const elements = getResponseElements(response.content);
            expect(elements.length).toBeGreaterThanOrEqual(1);
            expect(elements[0]?.text).toContain(
                "Docker responded with status code 404: No such container: non-existent"
            );
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should connect to a deployment when calling the tool", async ({ signal }) => {
        await waitUntilMcpClientIsSet(integration.mcpServer(), signal);
        // Create a deployment
        const deploymentName = `test-deployment-${Date.now()}`;
        await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName },
        });

        // Connect to the deployment
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-connect-deployment",
            arguments: { deploymentIdOrName: deploymentName },
        });
        const elements = getResponseElements(response.content);
        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(elements[0]?.text).toContain(
            'Successfully connected to Atlas Local deployment "' + deploymentName + '".'
        );

        // cleanup
        try {
            await integration.mcpClient().callTool({
                name: "atlas-local-delete-deployment",
                arguments: { deploymentName },
            });
        } catch (error) {
            console.warn(`Failed to delete deployment ${deploymentName}:`, error);
        }
    });
});
