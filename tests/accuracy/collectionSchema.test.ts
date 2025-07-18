import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Is there a title field in 'mflix.movies' namespace?",
        expectedToolCalls: [
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "What is the type of value stored in title field in movies collection in mflix database?",
        expectedToolCalls: [
            {
                toolName: "collection-schema",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
]);
