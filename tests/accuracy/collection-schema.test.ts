import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { collectionSchemaResponse } from "../../src/tools/mongodb/metadata/collectionSchema.js";
import { getSimplifiedSchema } from "mongodb-schema";

function callsCollectionSchema(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-schema": async function collectionSchema() {
                return collectionSchemaResponse(
                    "db1",
                    "coll1",
                    await getSimplifiedSchema([
                        {
                            name: "Sample name1",
                            dob: "28.11.2001",
                            location: "NY",
                        },
                        {
                            name: "Sample name1",
                            dob: "28.11.2001",
                            location: "NY",
                            title: "Dr.",
                        },
                    ])
                );
            },
        },
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

describeAccuracyTests("collection-schema", getAvailableModels(), [
    callsCollectionSchema("Is there a title field in 'db1.coll1' namespace?"),
    callsCollectionSchema("What is the type of value stored in title field in coll1 collection in db1 database?"),
]);
