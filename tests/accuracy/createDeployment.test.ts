import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describeAccuracyTests([
    {
        prompt: "Setup a local MongoDB cluster named 'local-cluster'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                },
            },
        ],
    },
    {
        prompt: "Create a local MongoDB instance named 'local-cluster'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                },
            },
        ],
    },
    {
        prompt: "Setup a local MongoDB database named 'local-cluster'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-cluster",
                },
            },
        ],
    },
    {
        prompt: "Setup a local MongoDB cluster, do not specify a name",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {},
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'new-database' does not exist, then create it",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "new-database",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'existing-database' does not exist, then create it",
        mockedTools: {
            "atlas-local-list-deployments": (): CallToolResult => ({
                content: [
                    { type: "text", text: "Found 1 deployment:" },
                    {
                        type: "text",
                        text: "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\nexisting-database | Running | 6.0",
                    },
                ],
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
]);
