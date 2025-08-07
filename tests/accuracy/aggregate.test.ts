import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Group all the movies in 'mflix.movies' namespace by 'release_year' and give me a count of them",
        expectedToolCalls: [
            {
                toolName: "aggregate",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    pipeline: [
                        { $group: { _id: "$release_year", count: { $sum: 1 } } },
                        // For the sake of accuracy, we allow any sort order
                        Matcher.anyOf(
                            Matcher.undefined,
                            Matcher.value({
                                $sort: Matcher.anyValue,
                            })
                        ),
                    ],
                },
            },
        ],
    },
]);
