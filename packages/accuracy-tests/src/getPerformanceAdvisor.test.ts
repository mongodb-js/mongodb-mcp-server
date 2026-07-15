import { formatUntrustedData } from "../../src/tools/tool.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Matcher } from "./sdk/matcher.js";

const projectId = "68f600519f16226591d054c0";

// Shared mock tool implementations
const mockedTools = {
    "atlas-list-projects": (): CallToolResult => {
        return {
            content: formatUntrustedData(
                "Found 1 projects",
                JSON.stringify([
                    {
                        name: "mflix",
                        id: projectId,
                        orgId: "68f600589f16226591d054c1",
                        orgName: "MyOrg",
                        created: "N/A",
                    },
                ])
            ),
        };
    },
    "atlas-list-clusters": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Found 1 cluster\n\n# | Name | Type | State\n---|------|------|-----\n1 | mflix-cluster | REPLICASET | IDLE",
                },
            ],
        };
    },
    "atlas-get-performance-advisor": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Found 2 performance advisor recommendations\n\n## Suggested Indexes\n# | Namespace | Weight | Avg Obj Size | Index Keys\n---|-----------|--------|--------------|------------\n1 | mflix.movies | 0.8 | 1024 | title, year\n2 | mflix.shows | 0.6 | 512 | genre, rating",
                },
            ],
        };
    },
};

const listProjectsAndClustersToolCalls = [
    {
        toolName: "atlas-list-projects",
        parameters: {},
        optional: true,
    },
    {
        toolName: "atlas-list-clusters",
        parameters: {
            projectId,
        },
        optional: true,
    },
];

describeAccuracyTests([
    // Test for Suggested Indexes operation
    {
        prompt: "Can you give me index suggestions for the database 'mflix' in the project named 'mflix' and cluster 'mflix-cluster'?",
        expectedToolCalls: [
            ...listProjectsAndClustersToolCalls,
            {
                toolName: "atlas-get-performance-advisor",
                parameters: {
                    projectId,
                    clusterName: "mflix-cluster",
                    operations: ["suggestedIndexes"],
                },
            },
        ],
        mockedTools,
    },
    // Test for Drop Index Suggestions operation
    {
        prompt: "Show me drop index suggestions for the project named 'mflix' and 'mflix-cluster' cluster",
        expectedToolCalls: [
            ...listProjectsAndClustersToolCalls,
            {
                toolName: "atlas-get-performance-advisor",
                parameters: {
                    projectId,
                    clusterName: "mflix-cluster",
                    operations: ["dropIndexSuggestions"],
                },
            },
        ],
        mockedTools,
    },
    // Test for Slow Query Logs operation
    {
        prompt: "Show me the slow query logs for the project named 'mflix' and 'mflix-cluster' cluster for the namespaces 'mflix.movies' and 'mflix.shows' since January 1st, 2023",
        expectedToolCalls: [
            ...listProjectsAndClustersToolCalls,
            {
                toolName: "atlas-get-performance-advisor",
                parameters: {
                    projectId,
                    clusterName: "mflix-cluster",
                    operations: ["slowQueryLogs"],
                    namespaces: ["mflix.movies", "mflix.shows"],
                    since: "2023-01-01T00:00:00Z",
                },
            },
        ],
        mockedTools,
    },
    // Test for Schema Suggestions operation
    {
        prompt: "Give me schema recommendations for the project named 'mflix' and 'mflix-cluster' cluster",
        expectedToolCalls: [
            ...listProjectsAndClustersToolCalls,
            {
                toolName: "atlas-get-performance-advisor",
                parameters: {
                    projectId,
                    clusterName: "mflix-cluster",
                    operations: ["schemaSuggestions"],
                },
            },
        ],
        mockedTools,
    },
    // Test for all operations
    {
        prompt: "Show me all performance advisor recommendations for the project named 'mflix' and 'mflix-cluster' cluster",
        expectedToolCalls: [
            ...listProjectsAndClustersToolCalls,
            {
                toolName: "atlas-get-performance-advisor",
                parameters: {
                    projectId,
                    clusterName: "mflix-cluster",
                    operations: Matcher.anyOf(
                        Matcher.undefined,
                        Matcher.value([
                            "suggestedIndexes",
                            "dropIndexSuggestions",
                            "slowQueryLogs",
                            "schemaSuggestions",
                        ])
                    ),
                },
            },
        ],
        mockedTools,
    },
]);
