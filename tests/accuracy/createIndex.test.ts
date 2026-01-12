import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { formatUntrustedData } from "../../src/tools/tool.js";
import type { MockedTools } from "./sdk/accuracyTestingClient.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

const mockedTools: MockedTools = {
    "collection-indexes": ({ collection }: Record<string, unknown>): CallToolResult => {
        return {
            content: formatUntrustedData(
                `Found 1 indexes in the collection "${collection as string}".`,
                JSON.stringify({
                    name: "_id_",
                    key: { _id: 1 },
                })
            ),
        };
    },
};

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
            mockedTools,
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
            mockedTools,
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
            mockedTools,
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
                                        numDimensions: Matcher.number((value) => {
                                            return value % 2 === 0 && value >= 256 && value <= 8192;
                                        }),
                                        similarity: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                        quantization: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                    },
                                    {
                                        type: "vector",
                                        path: "genre",
                                        numDimensions: Matcher.number((value) => {
                                            return value % 2 === 0 && value >= 256 && value <= 8192;
                                        }),
                                        similarity: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                        quantization: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
            mockedTools,
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
                                        similarity: Matcher.anyOf(Matcher.string(), Matcher.undefined),
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
            mockedTools,
        },
        {
            prompt: "Create an Atlas search index on 'mflix.movies' namespace with dynamic mappings enabled",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "search",
                                analyzer: Matcher.anyOf(Matcher.undefined, Matcher.value("lucene.standard")),
                                mappings: {
                                    dynamic: true,
                                },
                                numPartitions: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                            },
                        ],
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Create an Atlas search index on 'mflix.movies' namespace for searching on 'title' as string field and 'year' as number field",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "search",
                                analyzer: Matcher.anyOf(Matcher.undefined, Matcher.value("lucene.standard")),
                                mappings: {
                                    dynamic: Matcher.anyOf(Matcher.undefined, Matcher.value(false)),
                                    fields: {
                                        title: {
                                            type: "string",
                                        },
                                        year: {
                                            type: "number",
                                        },
                                    },
                                },
                                numPartitions: Matcher.anyOf(Matcher.undefined, Matcher.number()),
                            },
                        ],
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Create an Atlas search index on 'mflix.movies' namespace with a custom 'lucene.keyword' analyzer at the top level. Ensure 'title' is indexed as an autocomplete field and 'genres' as a string field, and 'released' as a date field",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: "search",
                                analyzer: "lucene.keyword",
                                mappings: {
                                    dynamic: Matcher.anyOf(Matcher.undefined, Matcher.value(false)),
                                    fields: {
                                        title: {
                                            type: "autocomplete",
                                        },
                                        genres: {
                                            type: "string",
                                        },
                                        released: {
                                            type: "date",
                                        },
                                    },
                                },
                            },
                        ],
                    },
                },
            ],
            mockedTools,
        },
    ],
    {
        userConfig: { previewFeatures: "search" },
        clusterConfig: {
            search: true,
        },
    }
);
