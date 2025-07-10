import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsCollectionIndexes(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "mongodb-ddl",
                parameters: {
                    command: {
                        name: "collection-indexes",
                        parameters: {
                            database: "mflix",
                            collection: "movies",
                        },
                    },
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsCollectionIndexes("How many indexes do I have in 'mflix.movies' namespace?"),
    callsCollectionIndexes("List all the indexes in movies collection in mflix database"),
    callsCollectionIndexes(
        `Is the following query: ${JSON.stringify({ runtime: { $lt: 100 } })} on the namespace 'mflix.movies' indexed?`
    ),
]);
