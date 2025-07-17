import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Group all the movies in 'mflix.movies' namespace by 'release_year' and give me a count of them",
        expectedToolCalls: [
            {
                toolName: "aggregate",
                parameters: {
                    pipeline: { $group: { _id: "$release_year", count: { $sum: 1 } } },
                },
            },
        ],
    },
]);
