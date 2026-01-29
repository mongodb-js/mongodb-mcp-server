import { expectDefined, getResponseElements } from "../../helpers.js";
import { afterEach, expect, it } from "vitest";
import { describeWithAtlasLocal, describeWithAtlasLocalDisabled } from "./atlasLocalHelpers.js";

describeWithAtlasLocal("atlas-local-create-deployment", (integration) => {
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

    it("should have the atlas-local-create-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expectDefined(createDeployment);
    });

    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expectDefined(createDeployment);
        expect(createDeployment.inputSchema.type).toBe("object");
        expectDefined(createDeployment.inputSchema.properties);
        expect(createDeployment.inputSchema.properties).toHaveProperty("deploymentName");
        expect(createDeployment.inputSchema.properties).toHaveProperty("loadSampleData");
    });

    it("should create a deployment when calling the tool", async () => {
        const deploymentName = `test-deployment-${Date.now()}`;

        // Check that deployment doesn't exist before creation
        const beforeResponse = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const beforeElements = getResponseElements(beforeResponse.content);
        expect(beforeElements.length).toBeGreaterThanOrEqual(1);
        expect(beforeElements[1]?.text ?? "").not.toContain(deploymentName);

        // Create a deployment
        deploymentNamesToCleanup.push(deploymentName);
        await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName },
        });

        // Check that deployment exists after creation
        const afterResponse = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });

        const afterElements = getResponseElements(afterResponse.content);
        expect(afterElements).toHaveLength(2);
        expect(afterElements[1]?.text ?? "").toContain(deploymentName);
    });

    it("should return an error when creating a deployment that already exists", async () => {
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

        // Check that the response is an error
        expect(response.isError).toBe(true);
        const elements = getResponseElements(response.content);
        // There should be one element, the error message
        expect(elements).toHaveLength(1);
        expect(elements[0]?.text).toContain("Container already exists: " + deploymentName);
    });

    it("should create a deployment with the correct name", async () => {
        // Create a deployment
        const deploymentName = `test-deployment-${Date.now()}`;
        deploymentNamesToCleanup.push(deploymentName);
        const createResponse = await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: { deploymentName },
        });

        // Check the response contains the deployment name
        const createElements = getResponseElements(createResponse.content);
        expect(createElements.length).toBeGreaterThanOrEqual(1);
        expect(createElements[0]?.text).toContain(deploymentName);

        // List the deployments
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const elements = getResponseElements(response.content);

        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(elements[1]?.text ?? "").toContain(deploymentName);
        expect(elements[1]?.text ?? "").toContain("Running");
    });

    it("should create a deployment when name is not provided", async () => {
        // Create a deployment
        const createResponse = await integration.mcpClient().callTool({
            name: "atlas-local-create-deployment",
            arguments: {},
        });

        // Check the response contains the deployment name
        const createElements = getResponseElements(createResponse.content);
        expect(createElements.length).toBeGreaterThanOrEqual(1);

        // Extract the deployment name from the response
        // The name should be in the format local<number>
        const deploymentName = createElements[0]?.text.match(/local\d+/)?.[0];
        expectDefined(deploymentName);
        deploymentNamesToCleanup.push(deploymentName);

        // List the deployments
        const response = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });

        // Check the deployment has been created
        const elements = getResponseElements(response.content);
        expect(elements.length).toBeGreaterThanOrEqual(1);
        expect(elements[1]?.text ?? "").toContain(deploymentName);
        expect(elements[1]?.text ?? "").toContain("Running");
    });
});

describeWithAtlasLocalDisabled("[MacOS in GitHub Actions] atlas-local-create-deployment", (integration) => {
    it("should not have the atlas-local-create-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expect(createDeployment).toBeUndefined();
    });
});
