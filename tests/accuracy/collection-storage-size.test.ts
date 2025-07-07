import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-scorers.js";

function callsCollectionStorageSize(prompt: string, expectedToolCalls: ExpectedToolCall[]): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: expectedToolCalls,
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call 'collection-storage-size' tool", [
        callsCollectionStorageSize("What is the size of 'mflix.movies' namespace", [
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "mflix",
                    collection: "movies",
                },
            },
        ]),
    ]),
    ...describeSuite("should call 'collection-storage-size' tool after another tool/s", [
        callsCollectionStorageSize("How much size is each collection in comics database", [
            {
                toolName: "list-collections",
                parameters: {
                    database: "comics",
                },
            },
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "comics",
                    collection: "books",
                },
            },
            {
                toolName: "collection-storage-size",
                parameters: {
                    database: "comics",
                    collection: "characters",
                },
            },
        ]),
    ]),
});
