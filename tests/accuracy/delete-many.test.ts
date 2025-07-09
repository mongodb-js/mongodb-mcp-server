import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsDeleteManyWithEmptyFilters(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    };
}

function callsDeleteManyWithFilters(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "delete-many",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                    filter: { runtime: { $lt: 100 } },
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsDeleteManyWithEmptyFilters("Delete all the documents from 'mflix.movies' namespace"),
    callsDeleteManyWithEmptyFilters("Purge the collection 'movies' in database 'mflix'"),
    callsDeleteManyWithFilters("Remove all the documents from namespace 'mflix.movies' where runtime is less than 100"),
]);
