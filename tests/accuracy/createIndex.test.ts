import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Create an index that covers the following query on 'mflix.movies' namespace - { \"release_year\": 1992 }",
        expectedToolCalls: [
            {
                toolName: "create-index",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    name: Matcher.anyOf(Matcher.undefined, Matcher.string()),
                    keys: {
                        release_year: 1,
                    },
                },
            },
        ],
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
                    keys: {
                        title: "text",
                    },
                },
            },
        ],
    },
]);
