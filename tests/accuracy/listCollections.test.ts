import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "How many collections do I have in database mflix?",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "mflix" },
            },
        ],
    },
    {
        prompt: "List all the collections in my MongoDB database mflix.",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "mflix" },
            },
        ],
    },
    {
        prompt: "Is there a shows collection in my MongoDB database mflix?",
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "mflix" },
            },
        ],
    },
    {
        prompt: "List all the collections that I have in total on my cluster?",
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
            {
                toolName: "list-collections",
                parameters: { database: "support" },
            },
        ],
    },
]);
