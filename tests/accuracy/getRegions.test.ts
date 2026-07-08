import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";
import type { ExpectedToolCall, LLMToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";
import { getClusterRegions, type CloudProvider } from "../../src/common/atlas/clusterRegions.js";

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const CLUSTER_NAME = "regions-eval-cluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const mockListClustersEmpty = {
    "atlas-list-clusters": (): CallToolResult => ({
        content: [
            {
                type: "text",
                text: `Found 0 clusters in project ${PROJECT_ID}.`,
            },
        ],
    }),
};

const mockListClustersWithFreeCluster = {
    "atlas-list-clusters": (): CallToolResult => ({
        content: [
            {
                type: "text",
                text:
                    `Found 1 cluster in project ${PROJECT_ID}:\n\n` +
                    `Name | Tier | Provider | Region\n-----|------|----------|-------\n` +
                    `${CLUSTER_NAME} | M0 (Free) | AWS | US_EAST_1`,
            },
        ],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

const optionalListClusters = [
    {
        toolName: "atlas-list-clusters",
        parameters: { projectId: PROJECT_ID },
        optional: true as const,
    },
];

const commonCreateMocks = {
    ...mockListProjects,
    ...mockListClustersEmpty,
};

function mockCreateClusterResponse(provider: string, region: string): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text:
                    `Cluster "${CLUSTER_NAME}" is being created in project "${PROJECT_ID}" (M10 REPLICASET on ${provider}/${region}). ` +
                    `Use the atlas-inspect-cluster tool with projectId "${PROJECT_ID}" and clusterName "${CLUSTER_NAME}" to poll for readiness.`,
            },
        ],
    });
}

function mockUpgradeResponse(): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text: `Cluster "${CLUSTER_NAME}" is being upgraded from Free to M10 Dedicated tier.`,
            },
        ],
    });
}

function mockGetRegionsResponse(): (params: Record<string, unknown>) => CallToolResult {
    return (params) => {
        const provider = params.provider as CloudProvider | undefined;
        const providers = getClusterRegions(provider);

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({ providers }, null, 2),
                },
            ],
        };
    };
}

function expectCreateCluster(provider: string, region: string): ExpectedToolCall[] {
    return [
        ...optionalListProjects,
        ...optionalListClusters,
        {
            toolName: "atlas-create-cluster",
            parameters: {
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider,
                region,
                clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
            },
        },
    ];
}

function regionScorer(expectedRegion: string, toolName = "atlas-create-cluster") {
    return (_baselineScore: number, actualToolCalls: LLMToolCall[]) => {
        const call = actualToolCalls.find((c) => c.toolName === toolName);
        if (!call) {
            return 0;
        }
        return call.parameters.region === expectedRegion ? 1 : 0;
    };
}

function withGetRegionsMock(mockedTools: AccuracyTestConfig["mockedTools"]): AccuracyTestConfig["mockedTools"] {
    return {
        ...mockedTools,
        "atlas-get-regions": mockGetRegionsResponse(),
    };
}

const regionEvalCases: AccuracyTestConfig[] = [
    // Category A — mapping traps (city-level; inline mapping steered wrong)
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in Paris`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "EU_WEST_3"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "EU_WEST_3"),
        customScorer: regionScorer("EU_WEST_3"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in London`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "EU_WEST_2"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "EU_WEST_2"),
        customScorer: regionScorer("EU_WEST_2"),
    },
    // Category B — unmapped regional phrases
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in South America`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "SA_EAST_1"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "SA_EAST_1"),
        customScorer: regionScorer("SA_EAST_1"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in South America`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("GCP", "SOUTH_AMERICA_EAST_1"),
        },
        expectedToolCalls: expectCreateCluster("GCP", "SOUTH_AMERICA_EAST_1"),
        customScorer: regionScorer("SOUTH_AMERICA_EAST_1"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on Azure in South America`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AZURE", "BRAZIL_SOUTH"),
        },
        expectedToolCalls: expectCreateCluster("AZURE", "BRAZIL_SOUTH"),
        customScorer: regionScorer("BRAZIL_SOUTH"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in Northern Europe`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "EU_NORTH_1"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "EU_NORTH_1"),
        customScorer: regionScorer("EU_NORTH_1"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in the Middle East`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "ME_SOUTH_1"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "ME_SOUTH_1"),
        customScorer: regionScorer("ME_SOUTH_1"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in Northeast Asia`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("GCP", "NORTHEASTERN_ASIA_PACIFIC"),
        },
        expectedToolCalls: expectCreateCluster("GCP", "NORTHEASTERN_ASIA_PACIFIC"),
        customScorer: regionScorer("NORTHEASTERN_ASIA_PACIFIC"),
    },
    // Category C — location-label-only (not in REGION_RECOMMENDATIONS)
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in Iowa`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("GCP", "CENTRAL_US"),
        },
        expectedToolCalls: expectCreateCluster("GCP", "CENTRAL_US"),
        customScorer: regionScorer("CENTRAL_US"),
    },
    // Category D — format normalization
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in eu-central-1`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "EU_CENTRAL_1"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "EU_CENTRAL_1"),
        customScorer: regionScorer("EU_CENTRAL_1"),
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in us central 1`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("GCP", "CENTRAL_US"),
        },
        expectedToolCalls: expectCreateCluster("GCP", "CENTRAL_US"),
        customScorer: regionScorer("CENTRAL_US"),
    },
    // Category E — upgrade path (regional phrase)
    {
        prompt: `Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 on AWS in South America`,
        mockedTools: {
            ...mockListProjects,
            ...mockListClustersWithFreeCluster,
            "atlas-upgrade-cluster": mockUpgradeResponse(),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            ...optionalListClusters,
            {
                toolName: "atlas-upgrade-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    targetTier: Matcher.anyOf(Matcher.value("M10"), Matcher.undefined),
                    provider: "AWS",
                    region: "SA_EAST_1",
                },
            },
        ],
        customScorer: regionScorer("SA_EAST_1", "atlas-upgrade-cluster"),
    },
    // Category F — exact code passthrough
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in AF_SOUTH_1`,
        mockedTools: {
            ...commonCreateMocks,
            "atlas-create-cluster": mockCreateClusterResponse("AWS", "AF_SOUTH_1"),
        },
        expectedToolCalls: expectCreateCluster("AWS", "AF_SOUTH_1"),
        customScorer: regionScorer("AF_SOUTH_1"),
    },
];

/** When set to `control` or `treatment`, only that suite runs. Omit to run both (not recommended — results share prompts). */
const evalVariant = process.env.MDB_ACCURACY_EVAL_VARIANT;
const runControl = !evalVariant || evalVariant === "control";
const runTreatment = !evalVariant || evalVariant === "treatment";

if (runControl) {
    describeAccuracyTests(regionEvalCases, {
        suiteLabel: "getRegions eval — control (no atlas-get-regions tool)",
    });
}

if (runTreatment) {
    describeAccuracyTests(
        regionEvalCases.map((testCase) => ({
            ...testCase,
            mockedTools: withGetRegionsMock(testCase.mockedTools),
        })),
        {
            suiteLabel: "getRegions eval — with atlas-get-regions tool",
            userConfig: { previewFeatures: "atlasGetRegions" },
        }
    );
}
