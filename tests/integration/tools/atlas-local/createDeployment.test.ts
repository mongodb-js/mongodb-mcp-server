import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
    waitUntilMcpClientIsSet,
} from "../../helpers.js";
import { afterEach, describe, expect, it } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";

// Docker is not available on macOS in GitHub Actions
// That's why we skip the tests on macOS in GitHub Actions
describe("atlas-local-create-deployment", () => {
    let deploymentNamesToCleanup: string[] = [];

    afterEach(async () => {
        // Clean up any deployments created during the test
        for (const deploymentName of deploymentNamesToCleanup) {
            try {
                await integration.mcpClient().callTool({
                    name: "atlas-local-delete-deployment",
                    arguments: { deploymentName },
                });
            } catch (error) {
                console.warn(`Failed to delete deployment ${deploymentName}:`, error);
            }
        }
        deploymentNamesToCleanup = [];
    });
    const integration = setupIntegrationTest(
        () => defaultTestConfig,
        () => defaultDriverOptions
    );

    it.skipIf(isMacOSInGitHubActions)("should have the atlas-local-create-deployment tool", async ({ signal }) => {
        await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expectDefined(createDeployment);
    });

    it.skipIf(!isMacOSInGitHubActions)(
        "[MacOS in GitHub Actions] should not have the atlas-local-create-deployment tool",
        async ({ signal }) => {
            // This should throw an error because the client is not set within the timeout of 5 seconds (default)
            await expect(waitUntilMcpClientIsSet(integration.mcpServer(), signal)).rejects.toThrow();

            const { tools } = await integration.mcpClient().listTools();
            const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
            expect(createDeployment).toBeUndefined();
        }
    );

    it.skipIf(isMacOSInGitHubActions)("should have correct metadata", async ({ signal }) => {
        await waitUntilMcpClientIsSet(integration.mcpServer(), signal);
        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expectDefined(createDeployment);
        expect(createDeployment.inputSchema.type).toBe("object");
        expectDefined(createDeployment.inputSchema.properties);
        expect(createDeployment.inputSchema.properties).toHaveProperty("deploymentName");
    });

    it.skipIf(isMacOSInGitHubActions).sequential(
        "should create a deployment when calling the tool",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

            // Count the current number of deployments
            const beforeResponse = await integration.mcpClient().callTool({
                name: "atlas-local-list-deployments",
                arguments: {},
            });
            const beforeNumberOfDeployments = parseInt(
                getResponseElements(beforeResponse.content)[0]?.text.match(/\d+/)?.[0] || "0",
                10
            );

            // Create a deployment
            const deploymentName = `test-deployment-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);
            await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: { deploymentName },
            });

            // Count the number of deployments after creating the deployment
            const afterResponse = await integration.mcpClient().callTool({
                name: "atlas-local-list-deployments",
                arguments: {},
            });
            const afterNumberOfDeployments = parseInt(
                getResponseElements(afterResponse.content)[0]?.text.match(/\d+/)?.[0] || "0",
                10
            );
            // Check that the number of deployments has increased by 1
            expect(afterNumberOfDeployments).toBe(beforeNumberOfDeployments + 1);
        }
    );

    it.skipIf(isMacOSInGitHubActions).sequential(
        "should return an error when creating a deployment that already exists",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

            // Create a deployment
            const deploymentName = `test-deployment-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);
            await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: { deploymentName },
            });

            // Try to create the same deployment again
            const response = await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: { deploymentName },
            });
            const elements = getResponseElements(response.content);
            expect(elements.length).toBeGreaterThanOrEqual(1);
            expect(elements[0]?.text).toContain("Container already exists: " + deploymentName);
        }
    );

    it.skipIf(isMacOSInGitHubActions).sequential(
        "should create a deployment with the correct name",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

            // Create a deployment
            const deploymentName = `test-deployment-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);
            await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: { deploymentName },
            });

            // List the deployments
            const response = await integration.mcpClient().callTool({
                name: "atlas-local-list-deployments",
                arguments: {},
            });
            const elements = getResponseElements(response.content);
            expect(elements.length).toBeGreaterThanOrEqual(1);
            expect(elements[1]?.text).toContain(deploymentName);
            expect(elements[1]?.text).toContain("Running");
        }
    );

    it.skipIf(isMacOSInGitHubActions).sequential(
        "should create a deployment when name is not provided",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);

            // Create a deployment
            await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: {},
            });

            // List the deployments
            const response = await integration.mcpClient().callTool({
                name: "atlas-local-list-deployments",
                arguments: {},
            });
            const elements = getResponseElements(response.content);
            expect(elements.length).toBeGreaterThanOrEqual(1);
            // Random name starts with local and a number
            const deploymentName = elements[1]?.text.match(/local\d+/)?.[0];
            expectDefined(deploymentName);
            deploymentNamesToCleanup.push(deploymentName);
            expect(elements[1]?.text).toContain("Running");
        }
    );

    it.skipIf(isMacOSInGitHubActions).sequential(
        "should delete a deployment when calling the tool",
        async ({ signal }) => {
            await waitUntilMcpClientIsSet(integration.mcpServer(), signal);
            // Create a deployment
            const deploymentName = `test-deployment-${Date.now()}`;
            await integration.mcpClient().callTool({
                name: "atlas-local-create-deployment",
                arguments: { deploymentName },
            });

            // Count the current number of deployments
            const beforeResponse = await integration.mcpClient().callTool({
                name: "atlas-local-list-deployments",
                arguments: {},
            });
            const beforeNumberOfDeployments = parseInt(
                getResponseElements(beforeResponse.content)[0]?.text.match(/\d+/)?.[0] || "0",
                10
            );

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
            const afterNumberOfDeployments = parseInt(
                getResponseElements(afterResponse.content)[0]?.text.match(/\d+/)?.[0] || "0",
                10
            );
            // Check that the number of deployments has decreased by 1
            expect(afterNumberOfDeployments).toBe(beforeNumberOfDeployments - 1);
        }
    );
});
