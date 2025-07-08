import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-snapshot-storage/snapshot-storage.js";

function onlyCallsDropCollection(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "drop-collection",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ],
    };
}

function callsDropCollection(prompt: string, expectedToolCalls: ExpectedToolCall[]): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls,
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call 'drop-collection' tool", [
        onlyCallsDropCollection("Remove mflix.movies namespace from my cluster."),
        onlyCallsDropCollection("Drop movies collection from mflix database."),
    ]),
    ...describeSuite("should call 'drop-collection' after calling other necessary tools", [
        callsDropCollection("Remove books collection from which ever database contains it.", [
            {
                toolName: "list-databases",
                parameters: {},
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "admin",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "comics",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "config",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "local",
                },
            },
            {
                toolName: "list-collections",
                parameters: {
                    database: "mflix",
                },
            },
            {
                toolName: "drop-collection",
                parameters: {
                    database: "comics",
                    collection: "books",
                },
            },
        ]),
    ]),
});
