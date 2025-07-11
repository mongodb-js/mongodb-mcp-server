import { describeAccuracyTests } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-snapshot-storage/snapshot-storage.js";

function callsLogsTool(prompt: string, toolCall: ExpectedToolCall): AccuracyTestConfig {
    return {
        prompt: prompt,
        expectedToolCalls: [toolCall],
    };
}

describeAccuracyTests(getAvailableModels(), [
    callsLogsTool("Were there any startup warnings for my MongoDB server?", {
        toolName: "mongodb-logs",
        parameters: {
            type: "startupWarnings",
        },
    }),
    callsLogsTool("Retrieve first 10 logs for my MongoDB server?", {
        toolName: "mongodb-logs",
        parameters: {
            type: "global",
            limit: 10,
        },
    }),
]);
