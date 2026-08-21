import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

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
                    dropTarget: Matcher.anyOf(Matcher.undefined, Matcher.boolean()),
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
