import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

/**
 * None of these tests score a parameter match on any of the models, likely
 * because we are using Zod.union, when we probably should've used
 * Zod.discriminatedUnion
 */
describeAccuracyTests([
    {
        prompt: `Will fetching documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        method: [
                            {
                                name: "find",
                                arguments: {
                                    filter: { release_year: 2020 },
                                },
                            },
                        ],
                    },
                    // Any addition to method itself will essentially change the explain output
                    ParameterScorers.noAdditionsAllowedForPaths(["method"])
                ),
            },
        ],
    },
    {
        prompt: `Will aggregating documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        method: [
                            {
                                name: "aggregate",
                                arguments: {
                                    pipeline: [
                                        {
                                            $match: { release_year: 2020 },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["method"])
                ),
            },
        ],
    },
    {
        prompt: `Will counting documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        method: [
                            {
                                name: "count",
                                arguments: {
                                    query: { release_year: 2020 },
                                },
                            },
                        ],
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["method"])
                ),
            },
        ],
    },
]);
