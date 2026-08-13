import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "What local MongoDB clusters do I have running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "What local MongoDB instances do I have running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "How many local MongoDB clusters are running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
]);
