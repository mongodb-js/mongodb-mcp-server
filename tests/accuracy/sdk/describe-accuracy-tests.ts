import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { discoverMongoDBTools, TestTools, MockedTools } from "./test-tools.js";
import { TestableModels } from "./models.js";
import { ExpectedToolCall, parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "./accuracy-scorers.js";
import { Agent, getVercelToolCallingAgent } from "./agent.js";

interface AccuracyTestConfig {
    prompt: string;
    expectedToolCalls: ExpectedToolCall[];
    mockedTools: MockedTools;
}

export function describeAccuracyTests(
    suiteName: string,
    models: TestableModels,
    accuracyTestConfigs: AccuracyTestConfig[]
) {
    const eachModel = describe.each(models);
    const eachTest = it.each(accuracyTestConfigs);

    eachModel(`$modelName - ${suiteName}`, function (model) {
        let mcpTools: Tool[];
        let testTools: TestTools;
        let agent: Agent;

        beforeAll(async () => {
            mcpTools = await discoverMongoDBTools();
        });

        beforeEach(() => {
            testTools = new TestTools(mcpTools);
            agent = getVercelToolCallingAgent();
        });

        eachTest("$prompt", async function (testConfig) {
            testTools.mockTools(testConfig.mockedTools);
            const conversation = await agent.prompt(testConfig.prompt, model, testTools.vercelAiTools());
            console.log("conversation", conversation);
            const toolCalls = testTools.getToolCalls();
            console.log("?????? toolCalls", toolCalls);
            console.log("???? expected", testConfig.expectedToolCalls);
            const toolCallingAccuracy = toolCallingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
            const parameterMatchingAccuracy = parameterMatchingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);

            expect(toolCallingAccuracy).not.toEqual(0);
            expect(parameterMatchingAccuracy).toBeGreaterThanOrEqual(0.5);
        });
    });
}
