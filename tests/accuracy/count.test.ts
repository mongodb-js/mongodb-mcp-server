import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "Count number of documents in 'mflix.movies' namespace.",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["query"])
                ),
            },
        ],
    },
    {
        prompt: "How many documents are there in 'characters' collection in 'comics' database?",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: withParameterScorer(
                    {
                        database: "comics",
                        collection: "characters",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["query"])
                ),
            },
        ],
    },
    {
        prompt: "Count all the documents in 'mflix.movies' namespace with runtime less than 100?",
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        query: { runtime: { $lt: 100 } },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["query"])
                ),
            },
        ],
    },
]);
