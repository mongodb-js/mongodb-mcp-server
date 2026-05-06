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

const PROJECT_ID = "proj-accuracy-test";
const CLUSTER_NAME = "MyCluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

describeAccuracyTests([
    {
        prompt: `Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to Flex tier`,
        mockedTools: {
            ...mockListProjects,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "Flex"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
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
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
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
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
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
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Flex", "M10 Dedicated"),
        },
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
        prompt: `Upgrade cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 using AWS in the US_EAST_1 region`,
        mockedTools: {
            ...mockListProjects,
            "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "M10 Dedicated"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
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
]);
