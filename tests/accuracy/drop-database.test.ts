import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-snapshot-storage/snapshot-storage.js";

function onlyCallsDropDatabase(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "drop-database",
                parameters: {
                    database: "mflix",
                },
            },
        ],
    };
}

function callsDropDatabase(prompt: string, expectedToolCalls: ExpectedToolCall[]): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls,
    };
}

describeAccuracyTests(getAvailableModels(), [
    onlyCallsDropDatabase("Remove mflix database from my cluster."),
    onlyCallsDropDatabase("Drop database named mflix."),
    callsDropDatabase("If there is a mflix database in my cluster then drop it.", [
        {
            toolName: "list-databases",
            parameters: {},
        },
        {
            toolName: "drop-database",
            parameters: {
                database: "mflix",
            },
        },
    ]),
]);
