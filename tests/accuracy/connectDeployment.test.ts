import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describeAccuracyTests([
    {
        prompt: "Connect to the local MongoDB cluster called 'my-database'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentIdOrName: "my-database",
                },
            },
        ],
    },
    {
        prompt: "Connect to the local MongoDB atlas database called 'my-instance'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentIdOrName: "my-instance",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'local-mflix' exists, then connect to it",
        mockedTools: {
            "atlas-local-list-deployments": (): CallToolResult => ({
                content: [
                    { type: "text", text: "Found 1 deployment:" },
                    {
                        type: "text",
                        text: "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\nlocal-mflix | Running | 6.0",
                    },
                ],
            }),
        },
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentIdOrName: "local-mflix",
                },
            },
        ],
    },
    {
        prompt: "Connect to a new local MongoDB cluster named 'local-mflix'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
            {
                toolName: "atlas-local-connect-deployment",
                parameters: {
                    deploymentIdOrName: "local-mflix",
                },
            },
        ],
    },
]);
