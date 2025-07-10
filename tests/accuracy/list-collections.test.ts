import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsListCollections(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "mflix" },
                    },
                },
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
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-databases",
                        parameters: {},
                    },
                },
            },
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "admin" },
                    },
                },
            },
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "comics" },
                    },
                },
            },
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "config" },
                    },
                },
            },
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "local" },
                    },
                },
            },
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "list-collections",
                        parameters: { database: "mflix" },
                    },
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsListCollections("How many collections do I have in database mflix?"),
    callsListCollections("List all the collections in my MongoDB database mflix."),
    callsListCollections("Is there a shows collection in my MongoDB database mflix?"),
    callsListDatabasesAndListCollections("List all the collections that I have in total on my cluster?"),
]);
