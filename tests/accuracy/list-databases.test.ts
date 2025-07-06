import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function callsListDatabases(prompt: string): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should only call list-databases tool", [
        callsListDatabases("How many databases do I have?"),
        callsListDatabases("List all the databases that I have in my clusters"),
        callsListDatabases("Is there a mflix database in my cluster?"),
    ]),
});
