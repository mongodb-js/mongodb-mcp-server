import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "What is the size occupied by database mflix?",
        expectedToolCalls: [
            {
                toolName: "db-stats",
                parameters: {
                    database: "mflix",
                },
            },
        ],
    },
]);
