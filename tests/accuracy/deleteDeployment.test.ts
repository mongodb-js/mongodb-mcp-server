import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

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
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            // There is none, so no delete call
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'local-mflix' exists, then delete it",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
            // There doesn't exist one so no delete call
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
