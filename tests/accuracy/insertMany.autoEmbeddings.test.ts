import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests(
    [
        {
            prompt: `\
Insert 2 movie documents in 'mflix.movies' namespace with the following fields:
1. \
title: "Matrix" \
plot: "A computer hacker learns about the true nature of his reality" \
2. \
title: "Jurassic Park" \
plot: "Pre-historic creatures come to life in this epic thrilling drama" \
'plot' field is covered with a vector search index so only if necessary, generate embeddings for it.
`,
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
                                    name: "plot_auto_embed_index",
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
                    optional: true,
                },
                {
                    toolName: "insert-many",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        documents: [
                            {
                                title: "Matrix",
                                plot: "A computer hacker learns about the true nature of his reality",
                            },
                            {
                                title: "Jurassic Park",
                                plot: "Pre-historic creatures come to life in this epic thrilling drama",
                            },
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
