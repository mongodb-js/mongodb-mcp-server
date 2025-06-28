import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";

describeAccuracyTests("list-databases", getAvailableModels(), [
    {
        prompt: "Assume that you're already connected. How many collections are there in sample_mflix database",
        mockedTools: {
            "list-collections": function listCollections() {
                return {
                    content: [
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
                parameters: { database: "sample_mflix" },
            },
        ],
    },
]);
