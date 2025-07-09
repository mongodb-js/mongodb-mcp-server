import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsListDatabases(prompt: string, database = "mflix"): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "db-stats",
                parameters: {
                    database,
                },
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), [callsListDatabases("What is the size occupied by database mflix?")]);
