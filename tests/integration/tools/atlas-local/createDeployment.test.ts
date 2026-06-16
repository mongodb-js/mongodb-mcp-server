import { defaultTestConfig, expectDefined, getResponseElements } from "../../helpers.js";
import { afterEach, expect, it } from "vitest";
import {
    createAtlasLocalDeployment,
    describeWithAtlasLocal,
    describeWithAtlasLocalDisabled,
} from "./atlasLocalHelpers.js";
import type { ListDatabasesOutput } from "../../../../src/tools/mongodb/metadata/listDatabases.js";
import type { ListCollectionsOutput } from "../../../../src/tools/mongodb/metadata/listCollections.js";

// Config used for tests that require a voyageApiKey.
const configWithVoyageApiKey = { ...defaultTestConfig, voyageApiKey: "test-voyage-api-key" };

describeWithAtlasLocal(
    "atlas-local-create-deployment",
    (integration) => {
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
            expect(createDeployment.inputSchema.properties).toHaveProperty("imageTag");
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
            await createAtlasLocalDeployment(integration, { deploymentName });

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
            await createAtlasLocalDeployment(integration, { deploymentName });

            // Try to create the same deployment again
            const response = await createAtlasLocalDeployment(integration, { deploymentName });

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
            const createResponse = await createAtlasLocalDeployment(integration, { deploymentName });

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
            const createResponse = await createAtlasLocalDeployment(integration);

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

        it("should create a deployment with voyageApiKey set when preview image is used", async () => {
            const deploymentName = `test-deployment-preview-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);

            const createResponse = await createAtlasLocalDeployment(integration, {
                deploymentName,
                imageTag: "preview",
            });

            const createElements = getResponseElements(createResponse.content);
            expect(createElements.length).toBeGreaterThanOrEqual(1);
            expect(createElements[0]?.text ?? "").toContain(deploymentName);

            const client = integration.mcpServer().session.atlasLocalClient;
            expectDefined(client);
            const deployment = await client.getDeployment(deploymentName);
            expect((deployment as { voyageApiKey?: string }).voyageApiKey).toBe(configWithVoyageApiKey.voyageApiKey);
        });

        it("should load sample data when loadSampleData is true", async () => {
            const deploymentName = `test-deployment-sample-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);

            const createResponse = await createAtlasLocalDeployment(integration, {
                deploymentName,
                loadSampleData: true,
            });
            const createElements = getResponseElements(createResponse.content);
            expect(createElements.length).toBeGreaterThanOrEqual(1);
            expect(createElements[0]?.text ?? "").toContain(deploymentName);

            // The MCP tool should propagate loadSampleData down to the underlying atlas-local client.
            const client = integration.mcpServer().session.atlasLocalClient;
            expectDefined(client);
            const deployment = await client.getDeployment(deploymentName);
            expect(deployment.mongodbLoadSampleData).toBe(true);

            // Connect so subsequent MongoDB tool calls target this deployment.
            await integration.mcpClient().callTool({
                name: "atlas-local-connect-deployment",
                arguments: { deploymentName },
            });

            // Verify the standard MongoDB sample datasets were loaded.
            const dbsResponse = await integration.mcpClient().callTool({
                name: "list-databases",
                arguments: {},
            });
            const dbsContent = dbsResponse.structuredContent as ListDatabasesOutput;
            const sampleDbNames = dbsContent.databases
                .map((db) => db.name)
                .filter((name) => name.startsWith("sample_"));
            expect(sampleDbNames).toContain("sample_mflix");

            // Verify a known collection from sample_mflix is present and has data.
            const collsResponse = await integration.mcpClient().callTool({
                name: "list-collections",
                arguments: { database: "sample_mflix" },
            });
            const collsContent = collsResponse.structuredContent as ListCollectionsOutput;
            const collNames = collsContent.collections.map((c) => c.name);
            expect(collNames).toContain("movies");

            const findResponse = await integration.mcpClient().callTool({
                name: "find",
                arguments: { database: "sample_mflix", collection: "movies", limit: 1 },
            });
            const findElements = getResponseElements(findResponse.content);
            // Element 0 is the summary line ("Query on collection ... resulted in N documents..."),
            // element 1 (when present) is the document payload.
            expect(findElements[0]?.text ?? "").toMatch(/resulted in [1-9]\d* documents/);
        });

        it("should create a deployment with imageTag latest", async () => {
            const deploymentName = `test-deployment-latest-${Date.now()}`;
            deploymentNamesToCleanup.push(deploymentName);

            // Create a deployment
            const createResponse = await createAtlasLocalDeployment(integration, {
                deploymentName,
                imageTag: "latest",
            });

            // Check the response contains the deployment name
            const createElements = getResponseElements(createResponse.content);
            expect(createElements.length).toBeGreaterThanOrEqual(1);
            expect(createElements[0]?.text ?? "").toContain(deploymentName);
        });
    },
    { config: configWithVoyageApiKey }
);

describeWithAtlasLocalDisabled("[MacOS in GitHub Actions] atlas-local-create-deployment", (integration) => {
    it("should not have the atlas-local-create-deployment tool", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const createDeployment = tools.find((tool) => tool.name === "atlas-local-create-deployment");
        expect(createDeployment).toBeUndefined();
    });
});
