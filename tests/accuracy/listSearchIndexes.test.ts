import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "how many search indexes do I have in the collection mydb.mycoll?",
        expectedToolCalls: [
            {
                toolName: "list-search-indexes",
                parameters: {
                    database: "mydb",
                    collection: "mycoll",
                },
            },
        ],
    },
    {
        prompt: "which vector search indexes do I have in mydb.mycoll?",
        expectedToolCalls: [
            {
                toolName: "list-search-indexes",
                parameters: {
                    database: "mydb",
                    collection: "mycoll",
                },
            },
        ],
    },
]);
