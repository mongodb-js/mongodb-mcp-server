import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests(
    [
        {
            prompt: "Run a vectorSearch query on 'mflix.movies' namespace, on path 'plot' using the index 'plot_index' to find all 'hammer of justice' movies.",
            mockedTools: {
                "collection-indexes": (): CallToolResult => {
                    return {
                        content: [
                            {
                                type: "text",
                                text: 'Found 1 search and vector search indexes in the collection "movies"',
                            },
                            {
                                type: "text",
                                text: JSON.stringify({
                                    name: "plot_index",
                                    type: "vectorSearch",
                                    status: "READY",
                                    latestDefinition: {
                                        type: "autoEmbed",
                                        path: "plot",
                                        model: "voyage-4-large",
                                        modality: "text",
                                    },
                                }),
                            },
                        ],
                    };
                },
            },
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
                                    index: "plot_index",
                                    path: "plot",
                                    query: { text: "hammer of justice" },
                                    model: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                                    exact: Matcher.anyValue,
                                    numCandidates: Matcher.anyValue,
                                    limit: Matcher.anyValue,
                                    filter: Matcher.anyValue,
                                },
                            },
                            Matcher.anyValue,
                        ],
                    },
                },
            ],
        },
    ],
    {
        userConfig: { voyageApiKey: process.env.MDB_VOYAGE_API_KEY, previewFeatures: "search" },
        clusterConfig: {
            autoEmbed: true,
            mongotPassword: process.env.MDB_MONGOT_PASSWORD as string,
            voyageIndexingKey: process.env.MDB_VOYAGE_API_KEY as string,
            voyageQueryKey: process.env.MDB_VOYAGE_API_KEY as string,
        },
    }
);
