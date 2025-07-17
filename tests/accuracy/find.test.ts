import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "List all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: {
                    database: "mflix",
                    collection: "movies",
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
        prompt: "Find all the movies in 'mflix.movies' namespace with runtime less than 100.",
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
                    projection: { title: 1 },
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
                    projection: { cast: 1 },
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
                    filter: { title: "Certain Fish" },
                    sort: { runtime: 1 },
                    limit: 2,
                },
            },
        ],
    },
]);
