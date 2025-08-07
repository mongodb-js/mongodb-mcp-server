import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Rename my 'mflix.movies' namespace to 'mflix.new_movies'",
        expectedToolCalls: [
            {
                toolName: "rename-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    newName: "new_movies",
                },
            },
        ],
    },
    {
        prompt: "Rename my 'mflix.movies' namespace to 'mflix.new_movies' while removing the old namespace.",
        expectedToolCalls: [
            {
                toolName: "rename-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    newName: "new_movies",
                    dropTarget: true,
                },
            },
        ],
    },
]);
