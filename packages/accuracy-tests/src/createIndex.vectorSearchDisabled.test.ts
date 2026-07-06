/**
 * Accuracy tests for when the vector search feature flag is disabled.
 *
 * TODO: Remove this file once we permanently enable the vector search feature.
 */
import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests(
    [
        {
            prompt: "(vectorSearchDisabled) Create an index that covers the following query on 'mflix.movies' namespace - { \"release_year\": 1992 }",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: Matcher.anyOf(Matcher.undefined, Matcher.value("classic")),
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
            prompt: "(vectorSearchDisabled) Create a text index on title field in 'mflix.movies' namespace",
            expectedToolCalls: [
                {
                    toolName: "create-index",
                    parameters: {
                        database: "mflix",
                        collection: "movies",
                        name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                        definition: [
                            {
                                type: Matcher.anyOf(Matcher.undefined, Matcher.value("classic")),
                                keys: {
                                    title: "text",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    ],
    {
        userConfig: { previewFeatures: "" },
    }
);
