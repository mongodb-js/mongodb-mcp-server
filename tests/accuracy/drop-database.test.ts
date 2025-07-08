import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-snapshot-storage/snapshot-storage.js";

function onlyCallsDropDatabase(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
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
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls,
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call 'drop-database' tool", [
        onlyCallsDropDatabase("Remove mflix database from my cluster."),
        onlyCallsDropDatabase("Drop database named mflix."),
    ]),
    ...describeSuite("should call 'drop-database' after calling other necessary tools", [
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
    ]),
});
