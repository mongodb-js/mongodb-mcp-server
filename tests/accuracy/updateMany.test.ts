import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "Update all the documents in 'mflix.movies' namespace with a new field 'new_field' set to 1",
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        update: {
                            $set: {
                                new_field: 1,
                            },
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["update"])
                ),
            },
        ],
    },
    {
        prompt: "Update all the documents in 'mflix.movies' namespace, where runtime is less than 100, with a new field 'new_field' set to 1",
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        filter: { runtime: { $lt: 100 } },
                        update: {
                            $set: {
                                new_field: 1,
                            },
                        },
                    },
                    ParameterScorers.noAdditionsAllowedForPaths(["filter", "update"])
                ),
            },
        ],
    },
]);
