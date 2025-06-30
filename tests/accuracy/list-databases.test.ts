import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function describeListDatabasesAccuracyTests(prompt: string): AccuracyTestConfig {
    return {
        systemPrompt: "Assume that you're already connected.",
        prompt: prompt,
        mockedTools: {
            "list-databases": function listDatabases() {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Name: db1",
                        },
                        {
                            type: "text",
                            text: "Name: db2",
                        },
                    ],
                };
            },
        },
        expectedToolCalls: [
            {
                toolName: "list-databases",
                parameters: {},
            },
        ],
    };
}

describeAccuracyTests("list-databases", getAvailableModels(), [
    describeListDatabasesAccuracyTests("How many databases do I have?"),
    describeListDatabasesAccuracyTests("List all the databases in my cluster."),
    describeListDatabasesAccuracyTests("Is there a sample_mflix database in my cluster?"),
]);
