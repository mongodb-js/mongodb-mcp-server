import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";

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

describeAccuracyTests([
    callsDeleteManyWithEmptyFilters("Delete all the documents from 'mflix.movies' namespace"),
    callsDeleteManyWithEmptyFilters("Purge the collection 'movies' in database 'mflix'"),
    callsDeleteManyWithFilters("Remove all the documents from namespace 'mflix.movies' where runtime is less than 100"),
]);
