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
        prompt: "Delete the local MongoDB database called 'my-instance'",
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
            {
                toolName: "atlas-local-delete-deployment",
                parameters: {},
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'local-mflix' exists, then delete it",
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
        prompt: "If and only if, the local MongoDB deployment 'new-database' does not exist, then create it",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: {},
            },
            {
                toolName: "create-collection",
                parameters: {
                    deploymentName: "new-database",
                },
            },
        ],
    },
]);
