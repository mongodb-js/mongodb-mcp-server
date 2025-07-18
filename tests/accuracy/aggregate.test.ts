import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { ParameterScorers, withParameterScorer } from "./sdk/parameterScorer.js";

describeAccuracyTests([
    {
        prompt: "Group all the movies in 'mflix.movies' namespace by 'release_year' and give me a count of them",
        expectedToolCalls: [
            {
                toolName: "aggregate",
                parameters: withParameterScorer(
                    {
                        database: "mflix",
                        collection: "movies",
                        pipeline: [{ $group: { _id: "$release_year", count: { $sum: 1 } } }],
                    },
                    // There should not be a $match at all hence the custom matcher
                    ParameterScorers.noAdditionsAllowedForPaths(["pipeline.0.$match"])
                ),
            },
        ],
    },
]);
