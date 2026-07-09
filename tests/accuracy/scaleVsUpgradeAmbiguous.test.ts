import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

/**
 * EXPERIMENT: scale-vs-upgrade tool-name/description ambiguity.
 *
 * Adversarial routing suite. Every case mocks BOTH tools; the model must route on
 * wording + tool descriptions alone. Deliberately uses "wrong-sounding" verbs:
 * scale/upgrade/resize/bump/grow are sprinkled across BOTH free/flex and dedicated
 * clusters so the verb alone never disambiguates — the current tier (stated in the
 * prompt) is the only reliable signal.
 *
 *   FREE/FLEX  -> atlas-upgrade-cluster        (regression guard)
 *   DEDICATED  -> atlas-scale-cluster    (only meaningful when scale tool exists)
 */

function mockScaleResponse(clusterName: string, targetInstanceSize: string): () => CallToolResult {
    return () => ({
        content: [
            { type: "text", text: `[scaffold] Cluster "${clusterName}" would be scaled to ${targetInstanceSize}.` },
        ],
    });
}

function mockUpgradeResponse(clusterName: string): () => CallToolResult {
    return () => ({
        content: [{ type: "text", text: `Cluster "${clusterName}" is being upgraded.` }],
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

const bothToolsMocked = (scaleTarget: string): Record<string, () => CallToolResult> => ({
    ...mockListProjects,
    "atlas-scale-cluster": mockScaleResponse(CLUSTER_NAME, scaleTarget),
    "atlas-upgrade-cluster": mockUpgradeResponse(CLUSTER_NAME),
});

// We only care about routing + core params, so provider/region (which the model may
// or may not include) accept any string or absence.
const anyStr = Matcher.anyOf(Matcher.string(), Matcher.undefined);

const expectUpgrade = [
    ...optionalListProjects,
    {
        toolName: "atlas-upgrade-cluster",
        parameters: {
            projectId: PROJECT_ID,
            clusterName: CLUSTER_NAME,
            targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.value("FLEX"), Matcher.undefined),
            provider: anyStr,
            region: anyStr,
        },
    },
];

const expectScale = (target: string) => [
    ...optionalListProjects,
    {
        toolName: "atlas-scale-cluster",
        parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, targetInstanceSize: target },
    },
];

const ff = (prompt: string) => ({ prompt, mockedTools: bothToolsMocked("M10"), expectedToolCalls: expectUpgrade });
const ded = (prompt: string, target: string) => ({
    prompt,
    mockedTools: bothToolsMocked(target),
    expectedToolCalls: expectScale(target),
});

// Discovery tools return a fixed ground-truth tier so the correct downstream tool is
// determined by that tier, not by the prompt.
const mockListClusters = (tier: string): (() => CallToolResult) => {
    return () => ({
        content: [
            {
                type: "text",
                text: `Found 1 cluster in project ${PROJECT_ID}:\n\nName | Tier | Provider | Region\n-----|------|----------|-------\n${CLUSTER_NAME} | ${tier} | AWS | US_EAST_1`,
            },
        ],
    });
};
const mockInspect = (tier: string): (() => CallToolResult) => {
    return () => ({
        content: [{ type: "text", text: `Cluster "${CLUSTER_NAME}": tier ${tier}, provider AWS, region US_EAST_1.` }],
    });
};

// TIER UNKNOWN: the prompt does NOT say free/flex/dedicated/Mxx. The model should
// discover the tier (list-clusters or inspect-cluster, both optional/accepted) and
// then route to the tier-appropriate tool. Discovering isn't required for a pass, but
// a model that guesses the WRONG tool for the (mocked) actual tier fails.
const discoverThenTool = (
    prompt: string,
    actualTier: string,
    final: { toolName: string; parameters: Record<string, unknown> }
) => ({
    prompt,
    mockedTools: {
        ...bothToolsMocked(typeof final.parameters.targetInstanceSize === "string" ? final.parameters.targetInstanceSize : "M10"),
        "atlas-list-clusters": mockListClusters(actualTier),
        "atlas-inspect-cluster": mockInspect(actualTier),
    },
    expectedToolCalls: [
        ...optionalListProjects,
        { toolName: "atlas-list-clusters", parameters: { projectId: PROJECT_ID }, optional: true as const },
        {
            toolName: "atlas-inspect-cluster",
            parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME },
            optional: true as const,
        },
        final,
    ],
});
const scaleFinal = (target: string) => ({
    toolName: "atlas-scale-cluster",
    parameters: { projectId: PROJECT_ID, clusterName: CLUSTER_NAME, targetInstanceSize: target },
});
const upgradeFinal = {
    toolName: "atlas-upgrade-cluster",
    parameters: {
        projectId: PROJECT_ID,
        clusterName: CLUSTER_NAME,
        targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.value("FLEX"), Matcher.undefined),
        provider: anyStr,
        region: anyStr,
    },
};

describeAccuracyTests([
    // FREE / FLEX, tier stated, adversarial verb ("scale up"/"bigger") -> upgrade
    ff(`Scale up my free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to a paid dedicated tier on AWS in US_EAST_1`),
    ff(`Make my free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" bigger — move it to a paid M10 tier on AWS in US_EAST_1`),

    // DEDICATED, tier stated, adversarial verb ("upgrade"/"grow") -> scale
    ded(`Upgrade my M30 dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M60`, "M60"),
    ded(`Move my M40 dedicated cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" down to M20 to save money`, "M20"),
    ded(`Grow my paid M50 cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M80 for more capacity`, "M80"),

    // TIER UNKNOWN: no tier in prompt — model must discover, then route on the actual tier.
    // Ground truth = DEDICATED -> scale.
    discoverThenTool(`Make the cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" bigger — take it to M50`, "M30 (DEDICATED)", scaleFinal("M50")),
    discoverThenTool(`"${CLUSTER_NAME}" in project "${PROJECT_ID}" is costing too much — drop it to M20`, "M50 (DEDICATED)", scaleFinal("M20")),
    // Ground truth = FREE/FLEX -> upgrade.
    discoverThenTool(`Make the cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" bigger`, "M0 (Free)", upgradeFinal),
    discoverThenTool(`Upgrade "${CLUSTER_NAME}" in project "${PROJECT_ID}" to the next tier up — AWS US_EAST_1 if asked`, "FLEX", upgradeFinal),
]);
