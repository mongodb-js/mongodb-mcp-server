import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";

function callsListDatabases(prompt: string): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    };
}

describeAccuracyTests([
    callsListDatabases("How many databases do I have?"),
    callsListDatabases("List all the databases that I have in my clusters"),
    callsListDatabases("Is there a mflix database in my cluster?"),
]);
