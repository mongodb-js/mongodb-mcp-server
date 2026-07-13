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

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const CLUSTER_NAME = "MyCluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

const anyStr = Matcher.anyOf(Matcher.string(), Matcher.undefined);
const anyTargetTier = Matcher.anyOf(Matcher.value("M10"), Matcher.value("FLEX"), Matcher.undefined);

// targetTier defaults to accepting M10/FLEX/undefined; provider/region accept any/absent.
function expectUpgrade(tier: unknown = anyTargetTier) {
    return [
        ...optionalListProjects,
        {
            toolName: "atlas-upgrade-free-cluster",
            parameters: {
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                targetTier: tier,
                provider: anyStr,
                region: anyStr,
            },
        },
    ];
}

const up = (prompt: string, tier: unknown = anyTargetTier) => ({
    prompt,
    mockedTools: {
        ...mockListProjects,
        "atlas-upgrade-free-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "Flex"),
    },
    expectedToolCalls: expectUpgrade(tier),
});

const flex = Matcher.anyOf(Matcher.value("FLEX"), Matcher.undefined);
const m10 = Matcher.anyOf(Matcher.value("M10"), Matcher.undefined);

describeAccuracyTests([
    // Free -> Flex
    up(`Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to Flex tier`, flex),
    // Free -> M10 Dedicated (provider/region supplied so the model doesn't stop to ask)
    up(`Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 Dedicated on AWS in US_EAST_1`, "M10"),
    // Flex -> Dedicated
    up(`Upgrade the Flex cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to Dedicated on AWS in US_EAST_1`, m10),

    // Discover then upgrade (list-clusters shows Free)
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
            "atlas-upgrade-free-cluster": mockUpgradeResponse(CLUSTER_NAME, "Free", "Flex"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            { toolName: "atlas-list-clusters", parameters: { projectId: PROJECT_ID } },
            {
                toolName: "atlas-upgrade-free-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: flex,
                    provider: anyStr,
                    region: anyStr,
                },
            },
        ],
    },
]);
