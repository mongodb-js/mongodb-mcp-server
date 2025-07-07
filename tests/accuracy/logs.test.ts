import { describeAccuracyTests, describeSuite } from "./sdk/describe-accuracy-tests.js";
import { getAvailableModels } from "./sdk/models.js";
import { AccuracyTestConfig } from "./sdk/describe-accuracy-tests.js";
import { ExpectedToolCall } from "./sdk/accuracy-scorers.js";

function callsLogsTool(prompt: string, toolCall: ExpectedToolCall): AccuracyTestConfig {
    return {
        injectConnectedAssumption: true,
        prompt: prompt,
        mockedTools: {},
        expectedToolCalls: [toolCall],
    };
}

describeAccuracyTests(getAvailableModels(), {
    ...describeSuite("should call 'logs' tool", [
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
    ]),
});
