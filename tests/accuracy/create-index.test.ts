import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsCreateIndex(prompt: string, indexKeys: Record<string, unknown>): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "create-index",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    keys: indexKeys,
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should call 'create-index' tool", [
        callsCreateIndex(
            "Create an index that covers the following query on 'mflix.movies' namespace - { \"release_year\": 1992 }",
            {
                release_year: 1,
            }
        ),
        callsCreateIndex("Create a text index on title field in 'mflix.movies' namespace", {
            title: "text",
        }),
    ]),
});
