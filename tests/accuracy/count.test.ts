import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Count number of documents in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "How many documents are there in 'characters' collection in 'comics' database?",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: {
                    database: "comics",
                    collection: "characters",
                },
            },
        ],
    },
    {
        prompt: "Count all the documents in 'mflix.movies' namespace with runtime less than 100?",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    query: { runtime: { $lt: 100 } },
                },
            },
        ],
    },
]);
