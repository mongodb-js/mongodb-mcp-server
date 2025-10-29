import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests(
    [
        {
            prompt: "Create an index that covers the following query on 'mflix.movies' namespace - { \"release_year\": 1992 }",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "classic",
                                keys: {
                                    release_year: 1,
                                },
                            },
                        ],
                    },
                },
            ],
        },
        {
            prompt: "Create a text index on title field in 'mflix.movies' namespace",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "classic",
                                keys: {
                                    title: "text",
                                },
                            },
                        ],
                    },
                },
            ],
        },
        {
            prompt: "Create a vector search index on 'mflix.movies' namespace on the 'plotSummary' field. The index should use 1024 dimensions.",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    {
                                        type: "vector",
                                        path: "plotSummary",
                                        numDimensions: 1024,
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
        {
            prompt: "Create a vector search index on 'mflix.movies' namespace with on the 'plotSummary' field and 'genre' field, both of which contain vector embeddings. Pick a sensible number of dimensions for a voyage 3.5 model.",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    {
                                        type: "vector",
                                        path: "plotSummary",
                                        numDimensions: Matcher.number(
                                            (value) => value % 2 === 0 && value >= 256 && value <= 8192
                                        ),
                                        similarity: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                    },
                                    {
                                        type: "vector",
                                        path: "genre",
                                        numDimensions: Matcher.number(
                                            (value) => value % 2 === 0 && value >= 256 && value <= 8192
                                        ),
                                        similarity: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
        {
            prompt: "Create a vector search index on 'mflix.movies' namespace where the 'plotSummary' field is indexed as a 1024-dimensional vector and the 'releaseDate' field is indexed as a regular field.",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    {
                                        type: "vector",
                                        path: "plotSummary",
                                        numDimensions: 1024,
                                    },
                                    {
                                        type: "filter",
                                        path: "releaseDate",
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
    ],
    {
        userConfig: { previewFeatures: "vectorSearch" },
        clusterConfig: {
            search: true,
        },
    }
);
