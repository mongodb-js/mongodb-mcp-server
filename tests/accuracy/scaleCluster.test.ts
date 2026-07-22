import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";
import type { ExpectedToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";

function mockScaleResponse(clusterName: string, instanceSize: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Cluster "${clusterName}" is being scaled to ${instanceSize}. Use the atlas-inspect-cluster tool to poll for readiness (state: IDLE).`,
            },
        ],
    });
}

function mockUpgradeResponse(clusterName: string): () => CallToolResult {
    return () => ({
        content: [{ type: "text", text: `Cluster "${clusterName}" is being upgraded. This may take a few minutes.` }],
    });
}

function mockInspectResponse(clusterName: string, instanceSize: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Cluster "${clusterName}": instance size ${instanceSize}, dedicated tier, state IDLE.`,
            },
        ],
    });
}

const PROJECT_ID = "proj-accuracy-test";
const CLUSTER_NAME = "MyCluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

const bothToolsMocked = (instanceSize: string): Record<string, () => CallToolResult> => ({
    ...mockListProjects,
    "atlas-scale-cluster": mockScaleResponse(CLUSTER_NAME, instanceSize),
    "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME),
});

const expectScale = (instanceSize: string): ExpectedToolCall[] => [
    ...optionalListProjects,
    {
        toolName: "atlas-scale-cluster",
        parameters: {
            projectId: PROJECT_ID,
            clusterName: CLUSTER_NAME,
            instanceSize,
        },
    },
];

describeAccuracyTests([
    {
        prompt: `Scale my dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" up to M30`,
        mockedTools: bothToolsMocked("M30"),
        expectedToolCalls: expectScale("M30"),
    },
    {
        prompt: `Resize the M40 cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" down to M20`,
        mockedTools: bothToolsMocked("M20"),
        expectedToolCalls: expectScale("M20"),
    },
    {
        prompt: `Change the instance size of my dedicated cluster "${CLUSTER_NAME}" (project "${PROJECT_ID}") to M50`,
        mockedTools: bothToolsMocked("M50"),
        expectedToolCalls: expectScale("M50"),
    },
    {
        // Autoscaling-only change (no target size) should still route to scale, not upgrade.
        prompt: `Set the max autoscaling tier to M60 for my dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}"`,
        mockedTools: bothToolsMocked("M60"),
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-scale-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    maxInstanceSize: "M60",
                    instanceSize: Matcher.undefined,
                },
            },
        ],
    },
    {
        // Regression guard: a Free-tier change must still go to upgrade, not scale.
        prompt: `Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to a dedicated M10 tier`,
        mockedTools: bothToolsMocked("M10"),
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.undefined),
                },
            },
        ],
    },
    {
        // Ambiguous request (tier not stated): the agent should inspect the cluster before choosing a tool.
        prompt: `Change cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M40`,
        mockedTools: {
            ...bothToolsMocked("M40"),
            "atlas-inspect-cluster": mockInspectResponse(CLUSTER_NAME, "M30"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-inspect-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            },
            {
                toolName: "atlas-scale-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, instanceSize: "M40" },
            },
        ],
    },
]);
