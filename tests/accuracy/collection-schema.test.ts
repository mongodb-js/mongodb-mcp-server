import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsCollectionSchema(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "collection-schema",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    };
}

describeAccuracyTests([
    callsCollectionSchema("Is there a title field in 'db1.coll1' namespace?"),
    callsCollectionSchema("What is the type of value stored in title field in coll1 collection in db1 database?"),
]);
