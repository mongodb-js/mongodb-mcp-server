import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Create a new namespace 'mflix.documentaries'",
        expectedToolCalls: [
            {
                toolName: "create-collection",
                parameters: {
                    database: "mflix",
                    collection: "documentaries",
                },
            },
        ],
    },
    {
        prompt: "Create a new collection villains in comics database",
        expectedToolCalls: [
            {
                toolName: "create-collection",
                parameters: {
                    database: "comics",
                    collection: "villains",
                },
            },
        ],
    },
    {
        prompt: "If and only if, the namespace 'mflix.documentaries' does not exist, then create it",
        expectedToolCalls: [
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
        ],
    },
]);
