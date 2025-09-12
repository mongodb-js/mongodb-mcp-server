import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Setup a local MongoDB cluster",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {},
            },
        ],
    },
    {
        prompt: "Create a local MongoDB instance",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {},
            },
        ],
    },
    {
        prompt: "Setup a local MongoDB database",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {},
            },
        ],
    },
    {
        prompt: "Create a local MongoDB database named 'local-mflix'",
        expectedToolCalls: [
            {
                toolName: "atlas-local-create-deployment",
                parameters: {
                    deploymentName: "local-mflix",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the local MongoDB deployment 'this-database' does not exist, then create it",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: {},
            },
            {
                toolName: "create-collection",
                parameters: {
                    deploymentName: "this-database",
                },
            },
        ],
    },
]);
