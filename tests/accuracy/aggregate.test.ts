import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

function doesUnset(field: string): Matcher {
    return Matcher.anyOf(
        // { $unset: "<field>" } || { $unset: ["<field>"] }
        Matcher.value({ $unset: Matcher.arrayOrSingle(Matcher.value(field)) }),
        // { $unset: { "<field>": "" } }
        Matcher.value({ $unset: { [field]: "" } })
    );
}

const embeddingParameters = {
    model: "voyage-3-large",
    outputDimension: Matcher.anyOf(
        Matcher.undefined,
        Matcher.number((n) => n === 1024)
    ),
    outputDType: Matcher.anyOf(Matcher.undefined, Matcher.value("float")),
};

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
                                embeddingParameters,
                                filter: Matcher.emptyObjectOrUndefined,
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                            },
                        },
                        doesUnset("title_embeddings"),
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
        prompt: "Run a vectorSearch query on musicfy.songs on path 'title_embeddings' using the index 'titles' with the model voyage-3-large to find all 'hammer of justice' songs. Keep the embedding field, do not remove it.",
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
                                embeddingParameters,
                                filter: Matcher.emptyObjectOrUndefined,
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                            },
                        },
                        Matcher.not(doesUnset("title_embeddings")),
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
                                exact: true,
                                index: "titles",
                                path: "title_embeddings",
                                queryVector: "hammer of justice",
                                embeddingParameters,
                                filter: Matcher.emptyObjectOrUndefined,
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                            },
                        },
                        doesUnset("title_embeddings"),
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
        prompt: "Run an approximate vectorSearch query on mflix.movies on path 'plot_embeddings' with the model voyage-3-large to find all 'sci-fi' movies.",
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
                                queryVector: "sci-fi",
                                embeddingParameters,
                                filter: Matcher.emptyObjectOrUndefined,
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                            },
                        },
                        doesUnset("plot_embeddings"),
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
    {
        prompt: "(Pre-filter) Run a vectorSearch query on mflix.movies on path 'plot_embeddings' with the model voyage-3-large to find all 'sci-fi' movies. I only want movies with the `released` after 1993 (included) and are published in catalan.",
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
                                queryVector: "sci-fi",
                                numCandidates: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                                embeddingParameters,
                                filter: {
                                    released: { $gte: 1993 },
                                    language: Matcher.caseInsensitiveString("catalan"),
                                },
                            },
                        },
                        doesUnset("plot_embeddings"),
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
                                    fields: [
                                        {
                                            type: "vector",
                                            path: "plot_embeddings",
                                            numDimensions: 1024,
                                            quantization: "none",
                                            similarity: "euclidean",
                                        },
                                        {
                                            type: "filter",
                                            path: "language",
                                        },
                                        {
                                            type: "filter",
                                            path: "released",
                                        },
                                    ],
                                },
                            }),
                        },
                    ],
                };
            },
        },
    },
    {
        prompt: "(No-prefilter) Run a vectorSearch query on mflix.movies on path 'plot_embeddings' with the model voyage-3-large to find all 'sci-fi' movies. I only want movies with `released` after 1993 (included) and are published in catalan.",
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
                                queryVector: "sci-fi",
                                numCandidates: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                                limit: Matcher.anyOf(Matcher.number(), Matcher.undefined),
                                embeddingParameters,
                                filter: Matcher.emptyObjectOrUndefined,
                            },
                        },
                        {
                            $match: {
                                released: { $gte: 1993 },
                                language: Matcher.caseInsensitiveString("catalan"),
                            },
                        },
                        doesUnset("plot_embeddings"),
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
                                    fields: [
                                        {
                                            type: "vector",
                                            path: "plot_embeddings",
                                            numDimensions: 1024,
                                            quantization: "none",
                                            similarity: "euclidean",
                                        },
                                    ],
                                },
                            }),
                        },
                    ],
                };
            },
        },
    },
]);
