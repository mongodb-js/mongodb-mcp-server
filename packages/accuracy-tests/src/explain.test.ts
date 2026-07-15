import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: `Will fetching all the documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: {
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
                    verbosity: Matcher.anyOf(Matcher.string(), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: `Will aggregating documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: {
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
                                responseBytesLimit: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                            },
                        },
                    ],
                    verbosity: Matcher.anyOf(Matcher.string(), Matcher.undefined),
                },
            },
        ],
    },
    {
        prompt: `Will counting documents, where release_year is 2020, from 'mflix.movies' namespace perform a collection scan?`,
        expectedToolCalls: [
            {
                toolName: "explain",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    method: [
                        {
                            name: "count",
                            arguments: {
                                query: {
                                    release_year: Matcher.anyOf(Matcher.value(2020), Matcher.value({ $eq: 2020 })),
                                },
                            },
                        },
                    ],
                    verbosity: Matcher.anyOf(Matcher.string(), Matcher.undefined),
                },
            },
        ],
    },
]);
