import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

describeAccuracyTests([
    {
        prompt: "Group all the movies in 'mflix.movies' namespace by 'release_year' and give me a count of them",
        expectedToolCalls: [
            {
                toolName: "aggregate",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    pipeline: [
                        { $group: { _id: "$release_year", count: { $sum: 1 } } },
                        // For the sake of accuracy, we allow any sort order
                        Matcher.anyOf(
                            Matcher.undefined,
                            Matcher.value({
                                $sort: Matcher.anyValue,
                            })
                        ),
                    ],
                },
            },
        ],
    },
    {
        prompt: "Run a vectorSearch query on musicfy.songs on path 'title_embeddings' using the index 'titles' with the model voyage-3-large to find all 'hammer of justice' songs.",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "musicfy",
                    collection: "songs",
                },
                optional: true,
            },
            {
                toolName: "aggregate",
                parameters: {
                    database: "musicfy",
                    collection: "songs",
                    pipeline: [
                        {
                            $vectorSearch: {
                                exact: Matcher.anyOf(Matcher.undefined, Matcher.boolean(false)),
                                index: "titles",
                                path: "title_embeddings",
                                queryVector: "hammer of justice",
                                embeddingParameters: {
                                    model: "voyage-3-large",
                                    outputDimension: Matcher.anyOf(
                                        Matcher.undefined,
                                        Matcher.number((n) => n === 1024)
                                    ),
                                },
                                filter: Matcher.emptyObjectOrUndefined,
                            },
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
        mockedTools: {
            "collection-indexes": (): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                name: "titles",
                                type: "vectorSearch",
                                status: "READY",
                                queryable: true,
                                latestDefinition: {
                                    type: "vector",
                                    path: "title_embeddings",
                                    numDimensions: 1024,
                                    quantization: "none",
                                    similarity: "euclidean",
                                },
                            }),
                        },
                    ],
                };
            },
        },
    },
    {
        prompt: "Run an exact vectorSearch query on musicfy.songs on path 'title_embeddings' using the index 'titles' with the model voyage-3-large to find 10 'hammer of justice' songs in any order.",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "musicfy",
                    collection: "songs",
                },
                optional: true,
            },
            {
                toolName: "aggregate",
                parameters: {
                    database: "musicfy",
                    collection: "songs",
                    pipeline: [
                        {
                            $vectorSearch: {
                                exact: Matcher.anyOf(Matcher.undefined, Matcher.boolean(true)),
                                index: "titles",
                                path: "title_embeddings",
                                queryVector: "hammer of justice",
                                limit: 10,
                                embeddingParameters: {
                                    model: "voyage-3-large",
                                    outputDimension: Matcher.anyOf(
                                        Matcher.undefined,
                                        Matcher.number((n) => n === 1024)
                                    ),
                                },
                                filter: Matcher.emptyObjectOrUndefined,
                            },
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
        mockedTools: {
            "collection-indexes": (): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                name: "titles",
                                type: "vectorSearch",
                                status: "READY",
                                queryable: true,
                                latestDefinition: {
                                    type: "vector",
                                    path: "title_embeddings",
                                    numDimensions: 1024,
                                    quantization: "none",
                                    similarity: "euclidean",
                                },
                            }),
                        },
                    ],
                };
            },
        },
    },
    {
        prompt: "Run an approximate vectorSearch query on mflix.movies on path 'plot_embeddings' with the model voyage-3-large to find all 'sci-fy' movies.",
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
            {
                toolName: "aggregate",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    pipeline: [
                        {
                            $vectorSearch: {
                                exact: Matcher.anyOf(Matcher.undefined, Matcher.boolean(false)),
                                index: "my-index",
                                path: "plot_embeddings",
                                queryVector: "sci-fy",
                                embeddingParameters: {
                                    model: "voyage-3-large",
                                    outputDimension: Matcher.anyOf(
                                        Matcher.undefined,
                                        Matcher.number((n) => n === 1024)
                                    ),
                                },
                                filter: Matcher.emptyObjectOrUndefined,
                            },
                        },
                    ],
                    responseBytesLimit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                },
            },
        ],
        mockedTools: {
            "collection-indexes": (): CallToolResult => {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                name: "my-index",
                                type: "vectorSearch",
                                status: "READY",
                                queryable: true,
                                latestDefinition: {
                                    type: "vector",
                                    path: "plot_embeddings",
                                    numDimensions: 1024,
                                    quantization: "none",
                                    similarity: "euclidean",
                                },
                            }),
                        },
                    ],
                };
            },
        },
    },
]);
