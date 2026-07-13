import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

/**
 * Tool-selection accuracy for `atlas-scale-cluster-instance` (scaffold) vs the existing
 * `atlas-upgrade-free-cluster`. Both tools are mocked; the model must route on wording +
 * tool descriptions alone.
 *   DEDICATED (M10+) resize up/down  -> atlas-scale-cluster-instance
 *   FREE / FLEX tier change          -> atlas-upgrade-free-cluster
 */

function mockScaleResponse(clusterName: string, targetInstanceSize: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `[scaffold] Cluster "${clusterName}" would be scaled to ${targetInstanceSize}. This tool is not yet wired up to the Atlas API.`,
            },
        ],
    });
}

function mockUpgradeResponse(clusterName: string): () => CallToolResult {
    return () => ({
        content: [{ type: "text", text: `Cluster "${clusterName}" is being upgraded. This may take a few minutes.` }],
    });
}

function mockInspect(tier: string): () => CallToolResult {
    return () => ({
        content: [{ type: "text", text: `Cluster "${CLUSTER_NAME}": tier ${tier}, provider AWS, region US_EAST_1.` }],
    });
}

function mockListClusters(tier: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Found 1 cluster in project ${PROJECT_ID}:\n\nName | Tier | Provider | Region\n-----|------|----------|-------\n${CLUSTER_NAME} | ${tier} | AWS | US_EAST_1`,
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

const bothToolsMocked = (scaleTarget: string): Record<string, () => CallToolResult> => ({
    ...mockListProjects,
    "atlas-scale-cluster-instance": mockScaleResponse(CLUSTER_NAME, scaleTarget),
    "atlas-upgrade-free-cluster": mockUpgradeResponse(CLUSTER_NAME),
});

const expectScale = (target: string) => [
    ...optionalListProjects,
    {
        toolName: "atlas-scale-cluster-instance",
        parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, targetInstanceSize: target },
    },
];

const expectUpgrade = [
    ...optionalListProjects,
    {
        toolName: "atlas-upgrade-free-cluster",
        parameters: {
            projectId: PROJECT_ID,
            clusterName: CLUSTER_NAME,
            targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.value("FLEX"), Matcher.undefined),
            provider: anyStr,
            region: anyStr,
        },
    },
];

// Dedicated resize -> scale.
const scale = (prompt: string, target: string) => ({
    prompt,
    mockedTools: bothToolsMocked(target),
    expectedToolCalls: expectScale(target),
});
// Free/flex tier change -> upgrade.
const upgrade = (prompt: string) => ({ prompt, mockedTools: bothToolsMocked("M10"), expectedToolCalls: expectUpgrade });

describeAccuracyTests([
    // DEDICATED (M10+), tier stated -> scale
    scale(`Scale the cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M30`, "M30"),
    scale(`Scale my M40 cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" down to M20`, "M20"),
    scale(`Make my M20 dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" bigger — go to M40`, "M40"),
    // "upgrade" red herring on an already-dedicated cluster -> still scale
    scale(`Upgrade my M30 dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M50`, "M50"),

    // FREE / FLEX, tier stated -> upgrade
    upgrade(`Upgrade my free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to a paid dedicated tier on AWS in US_EAST_1`),

    // ===================== Discover-then-act =====================
    // Discover tier (list-clusters shows M30) then "upgrade to M50" -> scale.
    {
        prompt: `Check what tier "${CLUSTER_NAME}" in project "${PROJECT_ID}" is on, then upgrade it to M50`,
        mockedTools: {
            ...bothToolsMocked("M50"),
            "atlas-list-clusters": mockListClusters("M30"),
            "atlas-inspect-cluster": mockInspect("M30 (DEDICATED)"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            { toolName: "atlas-list-clusters", parameters: { projectId: PROJECT_ID }, optional: true as const },
            {
                toolName: "atlas-inspect-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
                optional: true as const,
            },
            {
                toolName: "atlas-scale-cluster-instance",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, targetInstanceSize: "M50" },
            },
        ],
    },
    // Discover a FREE cluster then "make it bigger" -> upgrade (not scale).
    {
        prompt: `Check the tier of "${CLUSTER_NAME}" in project "${PROJECT_ID}", then make it bigger — put it on AWS in US_EAST_1 if needed`,
        mockedTools: {
            ...bothToolsMocked("M10"),
            "atlas-list-clusters": mockListClusters("M0 (Free)"),
            "atlas-inspect-cluster": mockInspect("M0 (FREE)"),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            { toolName: "atlas-list-clusters", parameters: { projectId: PROJECT_ID }, optional: true as const },
            {
                toolName: "atlas-inspect-cluster",
                parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
                optional: true as const,
            },
            {
                toolName: "atlas-upgrade-free-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.value("FLEX"), Matcher.undefined),
                    provider: anyStr,
                    region: anyStr,
                },
            },
        ],
    },
]);
