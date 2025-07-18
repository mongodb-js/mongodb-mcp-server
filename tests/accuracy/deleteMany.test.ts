import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "Delete all the documents from 'mflix.movies' namespace",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Purge the collection 'movies' in database 'mflix'",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                    },
                    ParameterScorers.emptyAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
    {
        prompt: "Remove all the documents from namespace 'mflix.movies' where runtime is less than 100",
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 } },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter"])
                ),
            },
        ],
    },
]);
