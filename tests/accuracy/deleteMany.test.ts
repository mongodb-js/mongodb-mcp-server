import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Delete all the documents from 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "Purge the collection 'movies' in database 'mflix'",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "Remove all the documents from namespace 'mflix.movies' where runtime is less than 100",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
]);
