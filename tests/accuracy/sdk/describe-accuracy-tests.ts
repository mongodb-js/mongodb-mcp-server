import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { discoverMongoDBTools, TestTools, MockedTools } from "./test-tools.js";
import { TestableModels } from "./models.js";
import { ExpectedToolCall, parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "./accuracy-scorers.js";
import { Agent, getVercelToolCallingAgent } from "./agent.js";
import { appendAccuracySnapshot } from "./accuracy-snapshot.js";

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
    const accuracyDatetime = process.env.MDB_ACCURACY_DATETIME;
    if (!accuracyDatetime) {
        throw new Error("MDB_ACCURACY_DATETIME environment variable is not set");
    }
    const accuracyCommit = process.env.MDB_ACCURACY_COMMIT;
    if (!accuracyCommit) {
        throw new Error("MDB_ACCURACY_COMMIT environment variable is not set");
    }

    if (!models.length) {
        console.warn(`No models available to test ${suiteName}`);
        return;
    }

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
            const toolCalls = testTools.getToolCalls();
            const toolCallingAccuracy = toolCallingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
            const parameterMatchingAccuracy = parameterMatchingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
            await appendAccuracySnapshot({
                datetime: accuracyDatetime,
                commit: accuracyCommit,
                model: model.modelName,
                suite: suiteName,
                test: testConfig.prompt,
                toolCallingAccuracy,
                parameterAccuracy: parameterMatchingAccuracy,
            });

            try {
                expect(toolCallingAccuracy).not.toEqual(0);
                expect(parameterMatchingAccuracy).toBeGreaterThanOrEqual(0.5);
            } catch (error) {
                console.warn(`Accuracy test failed for ${model.modelName} - ${suiteName} - ${testConfig.prompt}`);
                console.warn(`Conversation`, JSON.stringify(conversation, null, 2));
                console.warn(`Tool calls`, JSON.stringify(toolCalls, null, 2));
                console.warn(`Tool calling accuracy`, toolCallingAccuracy);
                console.warn(`Parameter matching accuracy`, parameterMatchingAccuracy);
                throw error;
            }
        });
    });
}
