import { PerformanceAdvisorOperation } from "../../src/common/atlas/performanceAdvisorUtils.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Shared mock tool implementations
const mockedTools = {
    "atlas-list-projects": (): CallToolResult => {
        return {
            content: [
                {
                    type: "text",
                    text: "Found 1 project\n\n# | Name | ID\n---|------|----\n1 | mflix | mflix",
                },
            ],
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
    "atlas-list-performance-advisor": (): CallToolResult => {
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

describeAccuracyTests([
    // Test for Suggested Indexes operation
    {
        prompt: "Can you give me index suggestions for the database 'mflix' in the project 'mflix' and cluster 'mflix-cluster'?",
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: "mflix",
                },
            },
            {
                toolName: "atlas-list-performance-advisor",
                parameters: {
                    projectId: "mflix",
                    clusterName: "mflix-cluster",
                    operations: [PerformanceAdvisorOperation.SUGGESTED_INDEXES],
                },
            },
        ],
        mockedTools,
    },
    // Test for Drop Index Suggestions operation
    {
        prompt: "Show me drop index suggestions for the 'mflix' project and 'mflix-cluster' cluster",
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: "mflix",
                },
            },
            {
                toolName: "atlas-list-performance-advisor",
                parameters: {
                    projectId: "mflix",
                    clusterName: "mflix-cluster",
                    operations: [PerformanceAdvisorOperation.DROP_INDEX_SUGGESTIONS],
                },
            },
        ],
        mockedTools,
    },
    // Test for Slow Query Logs operation
    {
        prompt: "Show me the slow query logs for the 'mflix' project and 'mflix-cluster' cluster?",
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: "mflix",
                },
            },
            {
                toolName: "atlas-list-performance-advisor",
                parameters: {
                    projectId: "mflix",
                    clusterName: "mflix-cluster",
                    operations: [PerformanceAdvisorOperation.SLOW_QUERY_LOGS],
                },
            },
        ],
        mockedTools,
    },
    // Test for Schema Suggestions operation
    {
        prompt: "Give me schema suggestions for the 'mflix' project and 'mflix-cluster' cluster",
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: "mflix",
                },
            },
            {
                toolName: "atlas-list-performance-advisor",
                parameters: {
                    projectId: "mflix",
                    clusterName: "mflix-cluster",
                    operations: [PerformanceAdvisorOperation.SCHEMA_SUGGESTIONS],
                },
            },
        ],
        mockedTools,
    },
    // Test for all operations
    {
        prompt: "Show me all performance advisor recommendations for the 'mflix' project and 'mflix-cluster' cluster",
        expectedToolCalls: [
            {
                toolName: "atlas-list-projects",
                parameters: {},
            },
            {
                toolName: "atlas-list-clusters",
                parameters: {
                    projectId: "mflix",
                },
            },
            {
                toolName: "atlas-list-performance-advisor",
                parameters: {
                    projectId: "mflix",
                    clusterName: "mflix-cluster",
                    operations: [
                        PerformanceAdvisorOperation.SUGGESTED_INDEXES,
                        PerformanceAdvisorOperation.DROP_INDEX_SUGGESTIONS,
                        PerformanceAdvisorOperation.SLOW_QUERY_LOGS,
                        PerformanceAdvisorOperation.SCHEMA_SUGGESTIONS,
                    ],
                },
            },
        ],
        mockedTools,
    },
]);
