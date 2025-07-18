import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { withParameterScorer, ParameterScorers } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "List all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "List all the documents in 'comics.books' namespace.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "comics",
                        collection: "books",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Find all the movies in 'mflix.movies' namespace with runtime less than 100.",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: {
                            runtime: { $lt: 100 },
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Find all movies in 'mflix.movies' collection where director is 'Christina Collins'",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: {
                            director: "Christina Collins",
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Give me all the movie titles available in 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        projection: { title: 1 },
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Use 'mflix.movies' namespace to answer who were casted in the movie 'Certain Fish'",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: { title: "Certain Fish" },
                        projection: { cast: 1 },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "From the mflix.movies namespace, give me first 2 movies of Horror genre sorted ascending by their runtime",
        expectedToolCalls: [
            {
                toolName: "find",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: { genres: "Horror" },
                        sort: { runtime: 1 },
                        limit: 2,
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
]);
