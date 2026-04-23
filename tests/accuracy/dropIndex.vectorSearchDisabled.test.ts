/**
 * Accuracy tests for when the vector search feature flag is disabled.
 *
 * TODO: Remove this file once we permanently enable the vector search feature.
 */
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
                        type: Matcher.anyOf(Matcher.undefined, Matcher.value("classic")),
                    },
                },
            ],
            mockedTools,
        },
        {
            prompt: "First create a text index on field 'title' in 'mflix.movies' namespace, verify the number of indexes and then drop all the indexes from 'mflix.movies' namespace",
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
                                type: "classic",
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
                        type: Matcher.anyOf(Matcher.undefined, Matcher.value("classic")),
                    },
                },
                {
                    toolName: "drop-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        indexName: Matcher.string(),
                        type: Matcher.anyOf(Matcher.undefined, Matcher.value("classic")),
                    },
                },
            ],
            mockedTools,
        },
    ],
    {
        userConfig: {
            previewFeatures: "",
        },
    }
);
