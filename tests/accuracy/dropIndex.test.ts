import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";
import { formatUntrustedData } from "../../src/tools/tool.js";

// We don't want to delete actual indexes
const mockedTools = {
    "drop-index": ({ indexName, database, collection }: Record<string, unknown>): CallToolResult => {
        return {
            content: formatUntrustedData(
                "Successfully dropped the index from the provided namespace.",
                JSON.stringify({
                    indexName,
                    namespace: `${database as string}.${collection as string}`,
                })
            ),
        };
    },
} as const;

describeAccuracyTests(
    [
        {
            prompt: "Delete the index called year_1 from mflix.movies namespace",
            expectedToolCalls: [
                {
                    toolName: "drop-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        indexName: "year_1",
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "First create a text index on field 'title' in 'mflix.movies' namespace and then drop all the indexes from 'mflix.movies' namespace",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                keys: {
                                    title: "text",
                                },
                            },
                        ],
                    },
                },
                {
                    toolName: "collection-indexes",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                    },
                },
                {
                    toolName: "drop-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        indexName: Matcher.string(),
                    },
                },
                {
                    toolName: "drop-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        indexName: Matcher.string(),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "Create a vector search index on 'mflix.movies' namespace on the 'plotSummary' field. The index should use 1024 dimensions. Confirm that its created and then drop the index.",
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
                {
                    toolName: "collection-indexes",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                    },
                },
                {
                    toolName: "drop-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        indexName: Matcher.string(),
                    },
                },
            ],
            mockedTools,
        },
    ],
    {
        userConfig: {
            voyageApiKey: "voyage-api-key",
        },
        clusterConfig: { search: true },
    }
);
