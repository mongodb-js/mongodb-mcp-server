import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsCountToolWithEmptyQuery(prompt: string, database = "mflix", collection = "movies"): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: {
                    database,
                    collection,
                },
            },
        ],
    };
}

function callsCountToolWithQuery(
    prompt: string,
    database = "mflix",
    collection = "movies",
    query: Record<string, unknown> = {}
): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "count",
                parameters: {
                    database,
                    collection,
                    query,
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call 'count' tool", [
        callsCountToolWithEmptyQuery("Count number of documents in 'mflix.movies' namespace."),
        callsCountToolWithEmptyQuery(
            "How many documents are there in 'characters' collection in 'comics' database?",
            "comics",
            "characters"
        ),
        callsCountToolWithQuery(
            "Count all the documents in 'mflix.movies' namespace with runtime less than 100?",
            "mflix",
            "movies",
            { runtime: { $lt: 100 } }
        ),
    ]),
});
