import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Export all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.emptyObjectOrUndefined,
                    limit: Matcher.undefined,
                },
            },
        ],
    },
    {
        prompt: "Export all the movies in 'mflix.movies' namespace with runtime less than 100.",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: {
                        runtime: { $lt: 100 },
                    },
                },
            },
        ],
    },
    {
        prompt: "Export all the movie titles available in 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    projection: {
                        title: 1,
                        _id: Matcher.anyOf(
                            Matcher.undefined,
                            Matcher.number((value) => value === 0)
                        ),
                    },
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "From the mflix.movies namespace, export the first 2 movies of Horror genre sorted ascending by their runtime",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { genres: "Horror" },
                    sort: { runtime: 1 },
                    limit: 2,
                },
            },
        ],
    },
]);
