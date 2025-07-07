import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsUpdateManyWithEmptyFilters(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    update: {
                        $set: {
                            new_field: 1,
                        },
                    },
                },
            },
        ],
    };
}

function callsUpdateManyWithFilters(prompt: string, filter: Record<string, unknown>): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "update-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter,
                    update: {
                        $set: {
                            new_field: 1,
                        },
                    },
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call aggregate tool", [
        callsUpdateManyWithEmptyFilters(
            "Update all the documents in 'mflix.movies' namespace with a new field 'new_field' set to 1"
        ),
        callsUpdateManyWithFilters(
            "Update all the documents in 'mflix.movies' namespace, where runtime is less than 100, with a new field 'new_field' set to 1",
            { runtime: { $lt: 100 } }
        ),
    ]),
});
