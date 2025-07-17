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
