import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsListCollections(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "mflix" },
            },
        ],
    };
}

function callsListDatabasesAndListCollections(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
            {
                toolName: "list-collections",
                parameters: { database: "admin" },
            },
            {
                toolName: "list-collections",
                parameters: { database: "comics" },
            },
            {
                toolName: "list-collections",
                parameters: { database: "config" },
            },
            {
                toolName: "list-collections",
                parameters: { database: "local" },
            },
            {
                toolName: "list-collections",
                parameters: { database: "mflix" },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call list-collections tool", [
        callsListCollections("How many collections do I have in database mflix?"),
        callsListCollections("List all the collections in my MongoDB database mflix."),
        callsListCollections("Is there a shows collection in my MongoDB database mflix?"),
    ]),
    ...describeSuite("should call list-databases and list-collections tool", [
        callsListDatabasesAndListCollections("List all the collections that I have in total on my cluster?"),
    ]),
});
