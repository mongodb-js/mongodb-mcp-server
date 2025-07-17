import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";

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

describeAccuracyTests([callsListDatabases("What is the size occupied by database mflix?")]);
