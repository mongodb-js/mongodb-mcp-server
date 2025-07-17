import { describeAccuracyTests } from "./sdk/describeAccuracyTests.js";
import { AccuracyTestConfig } from "./sdk/describeAccuracyTests.js";
import { ExpectedToolCall } from "./sdk/accuracyResultStorage/resultStorage.js";

function callsLogsTool(prompt: string, toolCall: ExpectedToolCall): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [toolCall],
    };
}

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
                    type: "global",
                    limit: 10,
                },
            },
        ],
    },
]);
