import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Export all the movies in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    exportTitle: Matcher.string(),
                    database: "mflix",
                    collection: "movies",
                    exportTarget: [
                        {
                            name: "find",
                            arguments: {},
                        },
                    ],
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
                    exportTitle: Matcher.string(),
                    database: "mflix",
                    collection: "movies",
                    exportTarget: [
                        {
                            name: "find",
                            arguments: {
                                filter: {
                                    runtime: { $lt: 100 },
                                },
                            },
                        },
                    ],
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
                    exportTitle: Matcher.string(),
                    database: "mflix",
                    collection: "movies",
                    exportTarget: [
                        {
                            name: "find",
                            arguments: {
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
            },
        ],
    },
    {
        prompt: "From the mflix.movies namespace, export the first 2 movies of Horror genre sorted ascending by their runtime",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    exportTitle: Matcher.string(),
                    database: "mflix",
                    collection: "movies",
                    exportTarget: [
                        {
                            name: "find",
                            arguments: {
                                filter: { genres: "Horror" },
                                sort: { runtime: 1 },
                                limit: 2,
                            },
                        },
                    ],
                },
            },
        ],
    },
    {
        prompt: "Export an aggregation that groups all movie titles by the field release_year from mflix.movies",
        expectedToolCalls: [
            {
                toolName: "export",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    exportTitle: Matcher.string(),
                    exportTarget: [
                        {
                            name: "aggregate",
                            arguments: {
                                pipeline: [
                                    {
                                        $group: {
                                            _id: "$release_year",
                                            titles: {
                                                $push: "$title",
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        ],
    },
]);
