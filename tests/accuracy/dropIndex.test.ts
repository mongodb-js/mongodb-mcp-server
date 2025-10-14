import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

// We don't want to delete actual indexes
const mockedTools = {
    "drop-index": ({ indexName, database, collection }: Record<string, unknown>): CallToolResult => {
        return {
            content: [
                {
                    text: `Successfully dropped the index with name "${String(indexName)}" from the provided namespace "${String(database)}.${String(collection)}".`,
                    type: "text",
                },
            ],
        };
    },
} as const;

describeAccuracyTests([
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
                    keys: {
                        title: "text",
                    },
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
]);
