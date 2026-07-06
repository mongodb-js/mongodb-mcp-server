import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const CLUSTER_NAME = "prod-cluster";

function mockPauseResumeResponse(action: "PAUSE" | "RESUME"): () => CallToolResult {
    return (): CallToolResult => ({
        content: [
            {
                type: "text",
                text:
                    action === "PAUSE"
                        ? `Cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" is being paused. ` +
                          `Paused clusters are unavailable for connections and do not incur compute costs.`
                        : `Cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" is being resumed. ` +
                          `Use the atlas-inspect-cluster tool with projectId "${PROJECT_ID}" and clusterName "${CLUSTER_NAME}" to poll for readiness. ` +
                          `The cluster is ready when its state is IDLE.`,
            },
        ],
    });
}

function mockInspectClusterResponse(paused: boolean): () => CallToolResult {
    return (): CallToolResult => ({
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    name: CLUSTER_NAME,
                    paused,
                    state: "IDLE",
                    instanceType: "DEDICATED",
                    instanceSize: "M10",
                    provider: "AWS",
                    region: "US_EAST_1",
                    mongoDBVersion: "8.0",
                    connectionStrings: paused
                        ? {}
                        : { standardSrv: `mongodb+srv://${CLUSTER_NAME}.example.mongodb.net` },
                }),
            },
        ],
    });
}

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

describeAccuracyTests([
    {
        prompt: `Pause cluster ${CLUSTER_NAME} in project ${PROJECT_ID}`,
        mockedTools: {
            ...mockListProjects,
            "atlas-pause-resume-cluster": mockPauseResumeResponse("PAUSE"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-pause-resume-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, action: "PAUSE" },
            },
        ],
    },
    {
        prompt: `Resume cluster ${CLUSTER_NAME} in project ${PROJECT_ID}`,
        mockedTools: {
            ...mockListProjects,
            "atlas-pause-resume-cluster": mockPauseResumeResponse("RESUME"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-pause-resume-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, action: "RESUME" },
            },
        ],
    },
    {
        prompt: `I want to save costs, is the ${CLUSTER_NAME} cluster in project ${PROJECT_ID} paused? If not, stop it`,
        mockedTools: {
            ...mockListProjects,
            "atlas-inspect-cluster": mockInspectClusterResponse(false),
            "atlas-pause-resume-cluster": mockPauseResumeResponse("PAUSE"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-inspect-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            },
            {
                toolName: "atlas-pause-resume-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, action: "PAUSE" },
            },
        ],
    },
    {
        prompt: `Unpause cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" and let me know when it's ready`,
        mockedTools: {
            ...mockListProjects,
            "atlas-pause-resume-cluster": mockPauseResumeResponse("RESUME"),
            "atlas-inspect-cluster": mockInspectClusterResponse(false),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-pause-resume-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, action: "RESUME" },
            },
            {
                toolName: "atlas-inspect-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            },
        ],
    },
]);
