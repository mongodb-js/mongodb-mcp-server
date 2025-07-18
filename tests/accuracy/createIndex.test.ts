import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "Create an index that covers the following query on 'mflix.movies' namespace - { \"release_year\": 1992 }",
        expectedToolCalls: [
            {
                toolName: "create-index",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        keys: {
                            release_year: 1,
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["keys"])
                ),
            },
        ],
    },
    {
        prompt: "Create a text index on title field in 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "create-index",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        keys: {
                            title: "text",
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["keys"])
                ),
            },
        ],
    },
]);
