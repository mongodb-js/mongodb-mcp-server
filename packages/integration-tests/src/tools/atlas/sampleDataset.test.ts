import { describeWithAtlas, withCluster } from "./atlasHelpers.js";
import { expectDefined, getResponseContent, getResponseElements } from "../../helpers.js";
import type { LoadSampleDatasetOutput } from "../../../../src/tools/atlas/create/loadSampleDataset.js";
import { describe, expect, it } from "vitest";

describeWithAtlas("atlas-load-sample-dataset", (integration) => {
    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const loadSampleDataset = tools.find((tool) => tool.name === "atlas-load-sample-dataset");

        expectDefined(loadSampleDataset);
        expect(loadSampleDataset.inputSchema.type).toBe("object");
        expectDefined(loadSampleDataset.inputSchema.properties);
        expect(loadSampleDataset.inputSchema.properties).toHaveProperty("projectId");
        expect(loadSampleDataset.inputSchema.properties).toHaveProperty("clusterName");
        expect(loadSampleDataset.inputSchema.properties).toHaveProperty("jobId");
    });

    describe("argument validation", () => {
        it("returns an error when both clusterName and jobId are provided", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-load-sample-dataset",
                arguments: {
                    projectId: "651b1d2a3a3f3a0001a1b2c3",
                    clusterName: "SomeCluster",
                    jobId: "651b1d2a3a3f3a0001a1b2c4",
                },
            });

            expect(response.isError).toBe(true);
            const content = getResponseContent(response.content);
            expect(content).toContain("Provide exactly one of");
            expect(content).toContain("clusterName");
            expect(content).toContain("jobId");
        });

        it("returns an error when neither clusterName nor jobId is provided", async () => {
            const response = await integration.mcpClient().callTool({
                name: "atlas-load-sample-dataset",
                arguments: {
                    projectId: "651b1d2a3a3f3a0001a1b2c3",
                },
            });

            expect(response.isError).toBe(true);
            const content = getResponseContent(response.content);
            expect(content).toContain("Provide exactly one of");
        });
    });

    withCluster(integration, ({ getProjectId, getClusterName }) => {
        it("initiates a sample dataset load and then checks its status by jobId", async () => {
            const projectId = getProjectId();
            const clusterName = getClusterName();

            // Step 1: initiate the load by passing clusterName.
            const initiateResponse = await integration.mcpClient().callTool({
                name: "atlas-load-sample-dataset",
                arguments: { projectId, clusterName },
            });

            expect(initiateResponse.isError).toBeFalsy();

            const initiateElements = getResponseElements(initiateResponse);
            expect(initiateElements).toHaveLength(2);
            expect(initiateElements[0]?.text).toContain("load requested");
            expect(initiateElements[0]?.text).toContain(clusterName);
            expect(initiateElements[0]?.text).toContain(projectId);

            const initiateStructured = initiateResponse.structuredContent as LoadSampleDatasetOutput | undefined;
            expectDefined(initiateStructured);
            expect(initiateStructured.jobId).toMatch(/^[a-f0-9]{24}$/);
            expect(initiateStructured.clusterName).toBe(clusterName);
            expect(initiateStructured.state).toBe("WORKING");
            expect(initiateStructured.createDate).toBeDefined();
            expect(initiateStructured.completeDate).toBeUndefined();
            expect(initiateStructured.errorMessage).toBeUndefined();

            // The second content block should be the JSON-serialized structuredContent.
            expect(JSON.parse(initiateElements[1]?.text ?? "")).toEqual(initiateStructured);

            // Step 2: poll the status using the jobId from the initiate response.
            const jobId = initiateStructured.jobId;
            const statusResponse = await integration.mcpClient().callTool({
                name: "atlas-load-sample-dataset",
                arguments: { projectId, jobId },
            });

            expect(statusResponse.isError).toBeFalsy();

            const statusElements = getResponseElements(statusResponse);
            expect(statusElements).toHaveLength(2);
            expect(statusElements[0]?.text).toContain("load status");
            expect(statusElements[0]?.text).toContain(clusterName);
            expect(statusElements[0]?.text).toContain(projectId);

            const statusStructured = statusResponse.structuredContent as LoadSampleDatasetOutput | undefined;
            expectDefined(statusStructured);
            expect(statusStructured.jobId).toBe(jobId);
            expect(statusStructured.clusterName).toBe(clusterName);
            // The load is asynchronous (1–5 minutes), so any of the three valid states is acceptable here.
            expect(statusStructured.state).toMatch(/^(WORKING|COMPLETED|FAILED)$/);

            expect(JSON.parse(statusElements[1]?.text ?? "")).toEqual(statusStructured);
        });
    });
});
