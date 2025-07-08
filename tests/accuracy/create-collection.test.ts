import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-snapshot-storage/snapshot-storage.js";

function callsCreateCollection(prompt: string, database: string, collection: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "create-collection",
                parameters: {
                    database,
                    collection,
                },
            },
        ],
    };
}

function callsCreateCollectionWithListCollections(prompt: string, expectedToolCalls: ExpectedToolCall[]) {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls,
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call 'create-collection' tool", [
        callsCreateCollection("Create a new namespace 'mflix.documentaries'", "mflix", "documentaries"),
        callsCreateCollection("Create a new collection villains in comics database", "comics", "villains"),
    ]),
    ...describeSuite("should call 'create-collection' alongside other required tools", [
        callsCreateCollectionWithListCollections(
            "If and only if, the namespace 'mflix.documentaries' does not exist, then create it",
            [
                {
                    toolName: "list-collections",
                    parameters: {
                        database: "mflix",
                    },
                },
                {
                    toolName: "create-collection",
                    parameters: {
                        database: "mflix",
                        collection: "documentaries",
                    },
                },
            ]
        ),
    ]),
});
