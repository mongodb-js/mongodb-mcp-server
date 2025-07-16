import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

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
