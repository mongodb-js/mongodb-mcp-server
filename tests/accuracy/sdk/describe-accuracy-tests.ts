import { AgentExecutor } from "langchain/agents";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { discoverMongoDBTools, TestTools, ToolResultGenerators } from "./test-tools.js";
import { TestableModels } from "./models.js";
import { getToolCallingAgent } from "./tool-calling-agent.js";
import { ExpectedToolCall, parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "./accuracy-scorers.js";

interface AccuracyTestConfig {
    prompt: string;
    expectedToolCalls: ExpectedToolCall[];
    mockedTools: ToolResultGenerators;
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
        let agent: AgentExecutor;

        beforeAll(async () => {
            mcpTools = await discoverMongoDBTools();
        });

        beforeEach(() => {
            testTools = new TestTools(mcpTools);
            const transformToolResult = model.transformToolResult.bind(model);
            agent = getToolCallingAgent(model, testTools.langChainTools(transformToolResult));
        });

        eachTest("$prompt", async function (testConfig) {
            testTools.mockTools(testConfig.mockedTools);
            const conversation = await agent.invoke({ input: testConfig.prompt });
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
