import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests(
    [
        {
            prompt: "Create an auto embed vector search index on 'plot' field in 'mflix.movies' namespace using voyage-4-large model.",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.string(), Matcher.undefined),
                        definition: [
                            {
                                type: "vectorSearch",
                                fields: [
                                    {
                                        type: "autoEmbed",
                                        path: "plot",
                                        model: "voyage-4-large",
                                        modality: "text",
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        },
        {
            prompt: `\
Check if there in existing vector search index on the 'plot' field in the 'mflix.movies' namespace. \
If not present then create an auto embed vector search index on the 'plot' field in the 'mflix.movies' namespace using voyage-4-large model.\
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
