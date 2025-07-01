import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { collectionIndexesResponse } from "../../src/tools/mongodb/read/collectionIndexes.js";

function callsCollectionIndexes(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {
            "collection-indexes": function collectionIndexes() {
                return collectionIndexesResponse({
                    database: "db1",
                    collection: "coll1",
                    indexes: [
                        {
                            name: "year",
                            key: JSON.stringify({ _id: 1 }),
                        },
                    ],
                });
            },
        },
        expectedToolCalls: [
            {
                toolName: "collection-indexes",
                parameters: {
                    database: "db1",
                    collection: "coll1",
                },
            },
        ],
    };
}

describeAccuracyTests("collection-indexes", getAvailableModels(), [
    callsCollectionIndexes("How many indexes do I have in 'db1.coll1' namespace?"),
    callsCollectionIndexes("List all the indexes in coll1 collection in db1 database"),
    callsCollectionIndexes(
        `Is the following query: ${JSON.stringify({ year: 1994 })} on the namespace 'db1.coll1' indexed?`
    ),
]);
