import { beforeEach } from "vitest";
import {
    defaultDriverOptions,
    defaultTestConfig,
    expectDefined,
    getResponseElements,
    setupIntegrationTest,
    validateToolMetadata,
} from "../../helpers.js";
import { afterEach, describe, expect, it } from "vitest";

const isMacOSInGitHubActions = process.platform === "darwin" && process.env.GITHUB_ACTIONS === "true";
const integration = setupIntegrationTest(
    () => defaultTestConfig,
    () => defaultDriverOptions
);

// Docker is not available on macOS in GitHub Actions
// That's why we skip the tests on macOS in GitHub Actions
describe.skipIf(isMacOSInGitHubActions)("atlas-local-connect-deployment", () => {
    validateToolMetadata(integration, "atlas-local-connect-deployment", "Connect to a MongoDB Atlas Local deployment", [
        {
            name: "deploymentName",
            type: "string",
            description: "Name of the deployment to connect to",
            required: true,
        },
    ]);

    it("should have the atlas-local-connect-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
        expectDefined(connectDeployment);
    });

    it("should return 'no such container' error when connecting to non-existent deployment", async () => {
        const deploymentName = "non-existent";
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-connect-deployment",
            arguments: { deploymentName },
        });
        const elements = getResponseElements(response.content);
        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(elements[0]?.text).toContain(
            `The Atlas Local deployment "${deploymentName}" was not found. Please check the deployment name or use "atlas-local-list-deployments" to see available deployments.`
        );
    });
});

describe.skipIf(isMacOSInGitHubActions)("atlas-local-connect-deployment with deployments", () => {
    let deploymentName: string = "";
    let deploymentNamesToCleanup: string[] = [];

    beforeEach(async () => {
        // Create deployments
        deploymentName = `test-deployment-1-${Date.now()}`;
        deploymentNamesToCleanup.push(deploymentName);
        await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName },
        });

        const anotherDeploymentName = `test-deployment-2-${Date.now()}`;
        deploymentNamesToCleanup.push(anotherDeploymentName);
        await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName: anotherDeploymentName },
        });
    });

    afterEach(async () => {
        // Delete all created deployments
        for (const deploymentNameToCleanup of deploymentNamesToCleanup) {
            try {
                await integration.mcpClient().callTool({
                    name: "atlas-local-delete-deployment",
                    arguments: { deploymentName: deploymentNameToCleanup },
                });
            } catch (error) {
                console.warn(`Failed to delete deployment ${deploymentNameToCleanup}:`, error);
            }
        }
        deploymentNamesToCleanup = [];
    });

    it("should connect to correct deployment when calling the tool", async () => {
        // Connect to the deployment
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-connect-deployment",
            arguments: { deploymentName },
        });
        const elements = getResponseElements(response.content);
        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(elements[0]?.text).toContain(`Successfully connected to Atlas Local deployment "${deploymentName}".`);
    });
});

describe.skipIf(!isMacOSInGitHubActions)("atlas-local-connect-deployment [MacOS in GitHub Actions]", () => {
    it("should not have the atlas-local-connect-deployment tool", async () => {
        // This should throw an error because the client is not set within the timeout of 5 seconds (default)
        const { tools } = await integration.mcpClient().listTools();
        const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
        expect(connectDeployment).toBeUndefined();
    });
});
