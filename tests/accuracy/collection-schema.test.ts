import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsCollectionSchema(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "collection-schema",
                        parameters: {
                            database: "db1",
                            collection: "coll1",
                        },
                    },
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsCollectionSchema("Is there a title field in 'db1.coll1' namespace?"),
    callsCollectionSchema("What is the type of value stored in title field in coll1 collection in db1 database?"),
]);
