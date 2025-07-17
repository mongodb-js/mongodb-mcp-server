import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "How many databases do I have?",
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    },
    {
        prompt: "List all the databases that I have in my clusters",
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    },
    {
        prompt: "Is there a mflix database in my cluster?",
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    },
]);
