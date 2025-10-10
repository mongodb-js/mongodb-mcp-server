import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describeAccuracyTests([
    {
        prompt: "Delete the local MongoDB cluster called 'my-database'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "my-database",
                },
            },
        ],
    },
    {
        prompt: "Delete the local MongoDB atlas database called 'my-instance'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "my-instance",
                },
            },
        ],
    },
    {
        prompt: "Delete all my local MongoDB instances",
        mockedTools: {
            "atlas-local-list-deployments": (): CallToolResult => ({
                content: [
                    { type: "text", text: "Found 1 deployment:" },
                    {
                        type: "text",
                        text: "Deployment Name | State | MongoDB Version\n----------------|----------------|----------------\nlocal-mflix | Running | 6.0\nlocal-comics | Running | 6.0",
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
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
            {
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "local-comics",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'local-mflix' exists, then delete it",
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
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
        ],
    },
    {
        prompt: "Create a local MongoDB cluster named 'local-mflix' then delete it immediately",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
            {
                toolName: "atlas-local-delete-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
        ],
    },
]);
