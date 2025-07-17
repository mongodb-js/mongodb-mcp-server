import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Remove mflix database from my cluster.",
        expectedToolCalls: [
            {
                toolName: "drop-database",
                parameters: {
                    database: "mflix",
                },
            },
        ],
    },
    {
        prompt: "Drop database named mflix.",
        expectedToolCalls: [
            {
                toolName: "drop-database",
                parameters: {
                    database: "mflix",
                },
            },
        ],
    },
    {
        prompt: "If there is a mflix database in my cluster then drop it.",
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
            {
                toolName: "drop-database",
                parameters: {
                    database: "mflix",
                },
            },
        ],
    },
]);
