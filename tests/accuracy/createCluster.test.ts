import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

const PROJECT_ID = "9123a4b056c7d890e1f2a3f4";
const PROJECT_NAME = "MyProject";
const CLUSTER_NAME = "accuracy-cluster";

const SOURCE_PROJECT_ID = "890e1f2a3f49123a4b056c7d";
const SOURCE_PROJECT_NAME = "MyOtherProject";
const SOURCE_CLUSTER_NAME = "prod-cluster";

interface ClusterMockParams {
    projectId: string;
    clusterName: string;
    instanceSize?: string;
    mongoDBVersion?: string;
    clusterType?: string;
    provider?: string;
    region?: string;
}

function mockCreateClusterResponse({
    projectId,
    clusterName,
    provider,
    region,
    instanceSize = "M10",
    clusterType = "REPLICASET",
}: ClusterMockParams): () => CallToolResult {
    return () => ({
        content: [
            {
                type: "text",
                text:
                    `Cluster "${clusterName}" is being created in project "${projectId}" (${instanceSize} ${clusterType} on ${provider}/${region}). ` +
                    `Use the atlas-inspect-cluster tool with projectId "${projectId}" and clusterName "${clusterName}" to poll for readiness. ` +
                    `The cluster is ready when its state is IDLE, connection strings are unavailable until then.`,
            },
        ],
    });
}

function mockInspectClusterResponse({
    clusterName,
    instanceSize,
    mongoDBVersion,
    provider,
    region,
}: ClusterMockParams): () => CallToolResult {
    return (): CallToolResult => ({
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    name: clusterName,
                    paused: false,
                    state: "IDLE",
                    instanceSize,
                    mongoDBVersion,
                    provider,
                    region,
                    connectionStrings: { standardSrv: `mongodb+srv://${clusterName}.example.mongodb.net` },
                }),
            },
        ],
    });
}

const mockListProjects = {
    "atlas-list-projects": (): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify([{ name: PROJECT_NAME, id: PROJECT_ID }]) }],
    }),
};

const optionalListProjects = [{ toolName: "atlas-list-projects", parameters: {}, optional: true as const }];

describeAccuracyTests([
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in US_EAST_1`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AWS",
                region: "US_EAST_1",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AWS",
                    region: "US_EAST_1",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Set up an M30 cluster called "${CLUSTER_NAME}" on GCP central US for project ${PROJECT_ID}`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "GCP",
                region: "CENTRAL_US",
                instanceSize: "M30",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "GCP",
                    region: "CENTRAL_US",
                    instanceSize: "M30",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `I need an Azure cluster called "${CLUSTER_NAME}" in europe_west for project ${PROJECT_ID}. Lock the version to 7.0.`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AZURE",
                region: "EUROPE_WEST",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AZURE",
                    region: "EUROPE_WEST",
                    mongoDBVersion: "7.0",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Set up cluster "${CLUSTER_NAME}" in project ${PROJECT_ID} on AWS US_EAST_1. I need point-in-time recovery enabled.`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AWS",
                region: "US_EAST_1",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AWS",
                    region: "US_EAST_1",
                    backup: "CONTINUOUS",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Create a dev cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in SOUTH_AMERICA_EAST_1 without any backups`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "GCP",
                region: "SOUTH_AMERICA_EAST_1",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "GCP",
                    region: "SOUTH_AMERICA_EAST_1",
                    backup: "OFF",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Provision an M30 cluster "${CLUSTER_NAME}" in project ${PROJECT_ID} on Azure North Europe. No autoscaling or backups.`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AZURE",
                region: "EUROPE_NORTH",
                instanceSize: "M30",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AZURE",
                    region: "EUROPE_NORTH",
                    instanceSize: "M30",
                    computeAutoScaling: false,
                    backup: "OFF",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Create a cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on AWS in EU_WEST_1, make sure it can't be accidentally removed.`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AWS",
                region: "EU_WEST_1",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AWS",
                    region: "EU_WEST_1",
                    terminationProtectionEnabled: true,
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        prompt: `Create a sharded cluster named "${CLUSTER_NAME}" in project "${PROJECT_ID}" on GCP in US_EAST_4`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "GCP",
                region: "US_EAST_4",
                clusterType: "SHARDED",
                instanceSize: "M30",
            }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "GCP",
                    region: "US_EAST_4",
                    clusterType: "SHARDED",
                    instanceSize: Matcher.anyOf(Matcher.undefined, Matcher.value("M30")),
                },
            },
        ],
    },
    {
        // Verify the model resolves the project ID when the project name is given in the prompt.
        // gpt-4o is the only model that tends to do an initial atlas-list-orgs call in this case.
        // Leaving altas-list-orgs un-mocked on purpose.
        prompt: `I need a new cluster called "${CLUSTER_NAME}" in my project "${PROJECT_NAME}" on AWS US_EAST_1`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AWS",
                region: "US_EAST_1",
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AWS",
                    region: "US_EAST_1",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
    {
        // Verify the model calls atlas-inspect-cluster to poll for readiness after creating the cluster
        prompt: `Spin up "${CLUSTER_NAME}" on AWS US_EAST_1 in project ${PROJECT_ID} and let me know when it's ready to use`,
        mockedTools: {
            ...mockListProjects,
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: CLUSTER_NAME,
                provider: "AWS",
                region: "US_EAST_1",
            }),
            "atlas-inspect-cluster": mockInspectClusterResponse({ projectId: PROJECT_ID, clusterName: CLUSTER_NAME }),
        },
        expectedToolCalls: [
            ...optionalListProjects,
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                    provider: "AWS",
                    region: "US_EAST_1",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
            {
                toolName: "atlas-inspect-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: CLUSTER_NAME,
                },
            },
        ],
    },
    {
        prompt: `Create a cluster in project "${PROJECT_ID}" with the same configuration and name as cluster "${SOURCE_CLUSTER_NAME}" in project "${SOURCE_PROJECT_ID}"`,
        mockedTools: {
            "atlas-list-projects": (): CallToolResult => ({
                content: [
                    {
                        type: "text",
                        text: JSON.stringify([
                            { name: SOURCE_PROJECT_NAME, id: SOURCE_PROJECT_ID },
                            { name: PROJECT_NAME, id: PROJECT_ID },
                        ]),
                    },
                ],
            }),
            "atlas-inspect-cluster": (params: Record<string, unknown>): CallToolResult => {
                if (params.projectId === PROJECT_ID) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Cluster "${SOURCE_CLUSTER_NAME}" not found in project "${PROJECT_ID}".`,
                            },
                        ],
                        isError: true,
                    };
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                clusterName: SOURCE_CLUSTER_NAME,
                                instanceType: "DEDICATED",
                                instanceSize: "M40",
                                paused: false,
                                state: "IDLE",
                                mongoDBVersion: "7.0",
                                provider: "AWS",
                                region: "EU_WEST_1",
                                clusterType: "REPLICASET",
                                connectionStrings: {
                                    standardSrv: `mongodb+srv://${SOURCE_CLUSTER_NAME}.example.mongodb.net`,
                                },
                            }),
                        },
                    ],
                };
            },
            "atlas-create-cluster": mockCreateClusterResponse({
                projectId: PROJECT_ID,
                clusterName: SOURCE_CLUSTER_NAME,
                provider: "AWS",
                region: "EU_WEST_1",
                instanceSize: "M40",
            }),
        },
        expectedToolCalls: [
            { toolName: "atlas-list-projects", parameters: {}, optional: true as const },
            {
                toolName: "atlas-inspect-cluster",
                parameters: {
                    projectId: SOURCE_PROJECT_ID,
                    clusterName: SOURCE_CLUSTER_NAME,
                },
            },
            {
                toolName: "atlas-inspect-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: SOURCE_CLUSTER_NAME,
                },
                optional: true as const,
            },
            {
                toolName: "atlas-create-cluster",
                parameters: {
                    projectId: PROJECT_ID,
                    clusterName: SOURCE_CLUSTER_NAME,
                    provider: "AWS",
                    region: "EU_WEST_1",
                    instanceSize: "M40",
                    mongoDBVersion: "7.0",
                    clusterType: Matcher.anyOf(Matcher.undefined, Matcher.value("REPLICASET")),
                },
            },
        ],
    },
]);
