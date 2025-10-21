import { expectDefined, getResponseElements } from "../../helpers.js";
import { expect, it } from "vitest";
import { describeWithAtlasLocal, describeWithAtlasLocalDisabled } from "./atlasLocalHelpers.js";

describeWithAtlasLocal("atlas-local-delete-deployment", (integration) => {
    it("should have the atlas-local-delete-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
        expectDefined(deleteDeployment);
    });

    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
        expectDefined(deleteDeployment);
        expect(deleteDeployment.inputSchema.type).toBe("object");
        expectDefined(deleteDeployment.inputSchema.properties);
        expect(deleteDeployment.inputSchema.properties).toHaveProperty("deploymentName");
    });

    it("should return 'no such container' error when deployment to delete does not exist", async () => {
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
    });

    it("should delete a deployment when calling the tool", async () => {
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

        // Check that deployment doesn't exist after deletion
        const afterResponse = await integration.mcpClient().callTool({
            name: "atlas-local-list-deployments",
            arguments: {},
        });
        const afterElements = getResponseElements(afterResponse.content);
        expect(afterElements[1]?.text ?? "").not.toContain(deploymentName);
    });
});

describeWithAtlasLocalDisabled("[MacOS in GitHub Actions] atlas-local-delete-deployment", (integration) => {
    it("should not have the atlas-local-delete-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const deleteDeployment = tools.find((tool) => tool.name === "atlas-local-delete-deployment");
        expect(deleteDeployment).toBeUndefined();
    });
});
