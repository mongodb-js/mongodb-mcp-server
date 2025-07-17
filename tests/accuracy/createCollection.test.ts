import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";
import { ExpectedToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";

function callsCreateCollection(prompt: string, database: string, collection: string): AccuracyTestConfig {
    return {
        prompt: prompt,
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

describeAccuracyTests([
    callsCreateCollection("Create a new namespace 'mflix.documentaries'", "mflix", "documentaries"),
    callsCreateCollection("Create a new collection villains in comics database", "comics", "villains"),
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
]);
