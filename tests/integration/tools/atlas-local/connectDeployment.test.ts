import { expect, it, beforeAll, afterAll } from "vitest";
import { expectDefined, getResponseElements, validateToolMetadata } from "../../helpers.js";
import { describeWithAtlasLocal, describeWithAtlasLocalDisabled } from "./atlasLocalHelpers.js";

describeWithAtlasLocal("atlas-local-connect-deployment", (integration) => {
    validateToolMetadata(
        integration,
        "atlas-local-connect-deployment",
        "Connect to a MongoDB Atlas Local deployment",
        "connect",
        [
            {
                name: "deploymentName",
                type: "string",
                description: "Name of the deployment to connect to",
                required: true,
            },
        ]
    );

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

describeWithAtlasLocal("atlas-local-connect-deployment with deployments", (integration) => {
    let deploymentName: string = "";
    let deploymentNamesToCleanup: string[] = [];

    beforeAll(async () => {
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

    afterAll(async () => {
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

    it("should be able to insert and read data after connecting", async () => {
        // Connect to the deployment
        await integration.mcpClient().callTool({
            name: "atlas-local-connect-deployment",
            arguments: { deploymentName },
        });

        const testDatabase = "test-db";
        const testCollection = "test-collection";
        const testData = [
            { name: "document1", value: 1 },
            { name: "document2", value: 2 },
        ];

        // Insert data using insert-many tool
        const insertResponse = await integration.mcpClient().callTool({
            name: "insert-many",
            arguments: {
                database: testDatabase,
                collection: testCollection,
                documents: testData,
            },
        });
        const insertElements = getResponseElements(insertResponse.content);
        expect(insertElements.length).toBeGreaterThanOrEqual(1);
        expect(insertElements[0]?.text).toContain("Documents were inserted successfully.");

        // Read data using find tool
        const findResponse = await integration.mcpClient().callTool({
            name: "find",
            arguments: {
                database: testDatabase,
                collection: testCollection,
            },
        });
        const findElements = getResponseElements(findResponse.content);
        expect(findElements.length).toBe(2);
        expect(findElements[0]?.text).toBe(
            'Query on collection "test-collection" resulted in 2 documents. Returning 2 documents.'
        );
        expect(findElements[1]?.text).toContain("document1");
        expect(findElements[1]?.text).toContain("document2");
    });
});

describeWithAtlasLocalDisabled("atlas-local-connect-deployment [MacOS in GitHub Actions]", (integration) => {
    it("should not have the atlas-local-connect-deployment tool", async () => {
        // This should throw an error because the client is not set within the timeout of 5 seconds (default)
        const { tools } = await integration.mcpClient().listTools();
        const connectDeployment = tools.find((tool) => tool.name === "atlas-local-connect-deployment");
        expect(connectDeployment).toBeUndefined();
    });
});
