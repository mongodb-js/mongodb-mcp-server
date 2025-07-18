import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "How many indexes do I have in 'mflix.movies' namespace?",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "List all the indexes in movies collection in mflix database",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: `Is the following query: ${JSON.stringify({ runtime: { $lt: 100 } })} on the namespace 'mflix.movies' indexed?`,
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
]);
