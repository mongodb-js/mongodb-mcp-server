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
                    filter: [
                        {
                            key: "runtime",
                            value: { $lt: 100 },
                        },
                    ],
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
                    filter: [
                        {
                            key: "director",
                            value: "Christina Collins",
                        },
                    ],
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
                    projection: [{ key: "title", value: 1 }],
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
                    filter: [{ key: "title", value: "Certain Fish" }],
                    projection: [{ key: "cast", value: 1 }],
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
                    filter: [{ key: "title", value: "Certain Fish" }],
                    sort: [{ key: "runtime", value: 1 }],
                    limit: 2,
                },
            },
        ],
    },
]);
