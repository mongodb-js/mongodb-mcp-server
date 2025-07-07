import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsAggregate(prompt: string, pipeline: Record<string, unknown>[]): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "aggregate",
                parameters: {
                    pipeline: pipeline,
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should call 'aggregate' tool", [
        callsAggregate(
            "Group all the movies in 'mflix.movies' namespace by 'release_year' and give me a count of them",
            [{ $group: { _id: "$release_year", count: { $sum: 1 } } }]
        ),
    ]),
});
