import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { Matcher } from "./sdk/matcher.js";

describeAccuracyTests([
    {
        prompt: "Were there any startup warnings for my MongoDB server?",
        expectedToolCalls: [
            {
                toolName: "mongodb-logs",
                parameters: {
                    type: "startupWarnings",
                },
            },
        ],
    },
    {
        prompt: "Retrieve first 10 logs for my MongoDB server?",
        expectedToolCalls: [
            {
                toolName: "mongodb-logs",
                parameters: {
                    type: Matcher.anyOf(Matcher.undefined, Matcher.value("global")),
                    limit: 10,
                },
            },
        ],
    },
]);
