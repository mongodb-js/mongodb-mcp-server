import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "What MongoDB clusters do I have running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "What MongoDB databases do I have running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "What MongoDB instances do I have running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
    {
        prompt: "How many MongoDB clusters are running?",
        expectedToolCalls: [
            {
                toolName: "atlas-local-list-deployments",
                parameters: {},
            },
        ],
    },
]);
