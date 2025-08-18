import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Remove mflix.movies namespace from my cluster.",
        expectedToolCalls: [
            {
                toolName: "drop-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "Drop movies collection from mflix database.",
        expectedToolCalls: [
            {
                toolName: "drop-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "Remove books collection from which ever database contains it.",
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "admin",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "comics",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "config",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "local",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "mflix",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "support",
                },
            },
            {
                toolName: "drop-collection",
                parameters: {
                    database: "comics",
                    collection: "books",
                },
            },
        ],
    },
]);
