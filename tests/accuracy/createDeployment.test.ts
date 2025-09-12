import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

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
]);
