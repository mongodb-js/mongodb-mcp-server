import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";

describeAccuracyTests([
    {
        prompt: "Is there a title field in 'db1.coll1' namespace?",
        expectedToolCalls: [
            {
                toolName: "collection-schema",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    },
    {
        prompt: "What is the type of value stored in title field in coll1 collection in db1 database?",
        expectedToolCalls: [
            {
                toolName: "collection-schema",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    },
]);
