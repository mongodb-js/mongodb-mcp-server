import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const PROJECT_NAME = "MyProject";
const CLUSTER_NAME = "accuracy-cluster";
const JOB_ID = "651b1d2a3a3f3a0001a1b2c4";

interface LoadMockParams {
    projectId: string;
    clusterName: string;
    jobId?: string;
    state?: "WORKING" | "COMPLETED" | "FAILED";
}

function mockLoadSampleDatasetResponse({
    projectId,
    clusterName,
    jobId = JOB_ID,
    state = "WORKING",
}: LoadMockParams): () => CallToolResult {
    return (): CallToolResult => {
        const structuredContent = {
            jobId,
            clusterName,
            state,
            createDate: "2026-06-11T00:00:00Z",
            ...(state !== "WORKING" ? { completeDate: "2026-06-11T00:03:00Z" } : {}),
        };

        const headerText =
            state === "WORKING"
                ? `Sample dataset load requested for cluster "${clusterName}" in project ${projectId}.`
                : `Sample dataset load status for cluster "${clusterName}" in project ${projectId}.`;

        return {
            content: [
                { type: "text", text: headerText },
                { type: "text", text: JSON.stringify(structuredContent) },
            ],
            structuredContent,
        };
    };
}

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: PROJECT_NAME, id: PROJECT_ID }]) }],
    }),
};

describeAccuracyTests([
    {
        prompt: `Load the sample dataset into cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}"`,
        mockedTools: {
            ...mockListProjects,
            "atlas-load-sample-dataset": mockLoadSampleDatasetResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
                optional: true,
            },
            {
                toolName: "atlas-load-sample-dataset",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                },
            },
        ],
    },
    {
        prompt: `Load sample data into cluster "${CLUSTER_NAME}" in my project "${PROJECT_NAME}"`,
        mockedTools: {
            ...mockListProjects,
            "atlas-load-sample-dataset": mockLoadSampleDatasetResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-load-sample-dataset",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                },
            },
        ],
    },
    {
        // Verify the model initiates the load and then polls the status using the returned jobId.
        prompt: `Load the sample dataset into cluster "${CLUSTER_NAME}" in project ${PROJECT_ID} and let me know once it's done`,
        mockedTools: {
            ...mockListProjects,
            "atlas-load-sample-dataset": (params: Record<string, unknown>): CallToolResult => {
                if (params.jobId !== undefined) {
                    return mockLoadSampleDatasetResponse({
                        projectId: PROJECT_ID,
                        clusterName: CLUSTER_NAME,
                        jobId: JOB_ID,
                        state: "COMPLETED",
                    })();
                }
                return mockLoadSampleDatasetResponse({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME })();
            },
        },
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
                optional: true,
            },
            {
                toolName: "atlas-load-sample-dataset",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                },
            },
            {
                toolName: "atlas-load-sample-dataset",
                parameters: {
                    projectId: PROJECT_ID,
                    jobId: JOB_ID,
                },
            },
        ],
    },
]);
