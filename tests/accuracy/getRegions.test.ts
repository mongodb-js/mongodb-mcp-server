import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AtlasCloudProvider } from "../../src/tools/args.js";
import { ATLAS_REGIONS } from "../../src/tools/atlas/read/getRegions.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const CLUSTER_NAME = "regions-accuracy-cluster";

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: "MyProject", id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [
    {
        toolName: "atlas-list-projects",
        parameters: {
            limit: Matcher.anyValue,
            pageNum: Matcher.anyValue,
        },
        optional: true as const,
    },
];

function mockGetRegionsResponse(params: Record<string, unknown>): CallToolResult {
    const provider = params.provider as AtlasCloudProvider;
    const structuredContent = {
        provider,
        regions: ATLAS_REGIONS[provider],
    };

    return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
    };
}

const mockCreateCluster = {
    "atlas-create-cluster": (): CallToolResult => ({
        content: [
            {
                type: "text",
                text: `Cluster "${CLUSTER_NAME}" is being created.`,
            },
        ],
    }),
};

const mockUpgradeCluster = {
    "atlas-upgrade-cluster": (): CallToolResult => ({
        content: [
            {
                type: "text",
                text: `Cluster "${CLUSTER_NAME}" is being upgraded from FREE to M10 tier.`,
            },
        ],
    }),
};

describeAccuracyTests([
    {
        prompt: "List the atlas regions for AWS",
        mockedTools: {
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "AWS" },
            },
        ],
    },
    {
        prompt: "What regions does atlas support in GCP?",
        mockedTools: {
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "GCP" },
            },
        ],
    },
    {
        prompt: "Which region code is AWS Mexico?",
        mockedTools: {
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "AWS" },
            },
        ],
    },
    {
        prompt: "What region should I use for Azure south america?",
        mockedTools: {
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "AZURE" },
            },
        ],
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in London`,
        mockedTools: {
            ...mockListProjects,
            ...mockCreateCluster,
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "GCP" },
            },
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "GCP",
                    regions: ["EUROPE_WEST_2"],
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Upgrade the free cluster "${CLUSTER_NAME}" in project "${PROJECT_ID}" to M10 on AWS in South America`,
        mockedTools: {
            ...mockListProjects,
            ...mockUpgradeCluster,
            "atlas-get-regions": mockGetRegionsResponse,
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-get-regions",
                parameters: { provider: "AWS" },
            },
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
    },
]);
