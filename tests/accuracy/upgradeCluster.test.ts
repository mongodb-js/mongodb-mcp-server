import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

function mockUpgradeResponse(clusterName: string, fromTier: string, toTier: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Cluster "${clusterName}" is being upgraded from ${fromTier} to ${toTier} tier. This may take a few minutes.`,
            },
        ],
    });
}

function mockScaleResponse(clusterName: string, targetInstanceSize: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Cluster "${clusterName}" is being scaled to ${targetInstanceSize}. This may take a few minutes.`,
            },
        ],
    });
}

function mockInspectClusterResponse(): CallToolResult {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    name: CLUSTER_NAME,
                    instanceType: "DEDICATED",
                    instanceSize: "M10",
                    provider: "AWS",
                    region: "US_EAST_1",
                    paused: false,
                    state: "IDLE",
                }),
            },
        ],
    };
}

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const CLUSTER_NAME = "MyCluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const mockInspectCluster = {
    "atlas-inspect-cluster": (): CallToolResult => mockInspectClusterResponse(),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

const optionalInspectCluster = [
    {
        toolName: "atlas-inspect-cluster",
        parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
        optional: true as const,
    },
];

describeAccuracyTests([
    {
        prompt: `Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to Flex tier`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "Flex"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: Matcher.anyOf(Matcher.value("FLEX"), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: `Upgrade the cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 Dedicated`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: "M10",
                },
            },
        ],
    },
    {
        prompt: `Upgrade my free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" directly to M10 Dedicated, skipping Flex`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: "M10",
                },
            },
        ],
    },
    {
        prompt: `Upgrade the Flex cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to Dedicated`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Flex", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
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
        prompt: `Upgrade cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 using AWS in the US_EAST_1 region`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: "M10",
                    provider: "AWS",
                    region: "US_EAST_1",
                },
            },
        ],
    },
    {
        prompt: `List the clusters in project "${PROJECT_ID}", then upgrade "${CLUSTER_NAME}" to Flex tier`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-list-clusters": (): CallToolResult => ({
                content: [
                    {
                        type: "text",
                        text: `Found 1 cluster in project ${PROJECT_ID}:\n\nName | Tier | Provider | Region\n-----|------|----------|-------\n${CLUSTER_NAME} | M0 (Free) | AWS | US_EAST_1`,
                    },
                ],
            }),
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "Flex"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: PROJECT_ID,
                },
            },
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: Matcher.anyOf(Matcher.value("FLEX"), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: `Scale cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M20`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockScaleResponse(CLUSTER_NAME, "M20"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: "M20",
                },
            },
        ],
    },
    {
        prompt: `Enable autoscaling on cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" between M10 and M30`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockScaleResponse(CLUSTER_NAME, "M10"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    computeAutoScaling: true,
                    minInstanceSize: "M10",
                    maxInstanceSize: "M30",
                    targetTier: Matcher.undefined,
                },
            },
        ],
    },
    {
        prompt: `Disable autoscaling on cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}"`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockScaleResponse(CLUSTER_NAME, "M10"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    computeAutoScaling: false,
                    targetTier: Matcher.undefined,
                },
            },
        ],
    },
    {
        prompt: `Increase the max autoscaling size on cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M40`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockScaleResponse(CLUSTER_NAME, "M10"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    maxInstanceSize: "M40",
                    targetTier: Matcher.undefined,
                },
            },
        ],
    },
    {
        prompt: `Upgrade my free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 Dedicated with autoscaling disabled`,
        mockedTools: {
            ...mockListProjects,
            ...mockInspectCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalInspectCluster,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: "M10",
                    computeAutoScaling: false,
                },
            },
        ],
    },
]);
