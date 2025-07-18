import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "List all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "List all the documents in 'comics.books' namespace.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "comics",
                    collection: "books",
                    filter: Matcher.emptyObjectOrUndefined,
                },
            },
        ],
    },
    {
        prompt: "Find all the movies in 'mflix.movies' namespace with runtime less than 100.",
        expectedToolCalls: [
            {
                toolName: "find",
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
        prompt: "Find all movies in 'mflix.movies' collection where director is 'Christina Collins'",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: {
                        director: "Christina Collins",
                    },
                },
            },
        ],
    },
    {
        prompt: "Give me all the movie titles available in 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "find",
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
        prompt: "Use 'mflix.movies' namespace to answer who were casted in the movie 'Certain Fish'",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { title: "Certain Fish" },
                    projection: {
                        cast: 1,
                        _id: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                    },
                    limit: Matcher.number((value) => value > 0),
                },
            },
        ],
    },
    {
        prompt: "From the mflix.movies namespace, give me first 2 movies of Horror genre sorted ascending by their runtime",
        expectedToolCalls: [
            {
                toolName: "find",
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
