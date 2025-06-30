import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";

function describeListCollectionsAccuracyTests(prompt: string): AccuracyTestConfig {
    return {
        systemPrompt: "Assume that you're already connected.",
        prompt: prompt,
        mockedTools: {
            "list-collections": function listCollections() {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Name: coll1",
                        },
                        {
                            type: "text",
                            text: "Name: coll1",
                        },
                    ],
                };
            },
        },
        expectedToolCalls: [
            {
                toolName: "list-collections",
                parameters: { database: "db1" },
            },
        ],
    };
}

describeAccuracyTests("list-collections", getAvailableModels(), [
    describeListCollectionsAccuracyTests("How many collections do I have in database db1?"),
    describeListCollectionsAccuracyTests("List all the collections in my MongoDB database db1."),
    describeListCollectionsAccuracyTests("Is there a coll1 collection in my MongoDB database db1?"),
]);
