import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "What is the size of 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    },
    {
        prompt: "How much size is each collection in comics database",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: {
                    database: "comics",
                },
            },
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "comics",
                    collection: "books",
                },
            },
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "comics",
                    collection: "characters",
                },
            },
        ],
    },
]);
