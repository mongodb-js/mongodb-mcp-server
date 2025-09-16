import { PerformanceAdvisorOperation } from "../../src/common/atlas/performanceAdvisorUtils.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describeAccuracyTests([
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
        mockedTools: {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            "atlas-list-performance-advisor": (..._parameters): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Found 2 performance advisor recommendations\n\n## Suggested Indexes\n# | Namespace | Weight | Avg Obj Size | Index Keys\n---|-----------|--------|--------------|------------\n1 | mflix.movies | 0.8 | 1024 | title, year\n2 | mflix.shows | 0.6 | 512 | genre, rating",
                        },
                    ],
                };
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            "atlas-list-projects": (..._parameters): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Found 1 project\n\n# | Name | ID\n---|------|----\n1 | mflix | mflix",
                        },
                    ],
                };
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            "atlas-list-clusters": (..._parameters): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Found 1 cluster\n\n# | Name | Type | State\n---|------|------|-----\n1 | mflix-cluster | REPLICASET | IDLE",
                        },
                    ],
                };
            },
        },
    },
]);
