import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { discoverMongoDBTools, TestTools, MockedTools } from "./test-tools.js";
import { TestableModels } from "./models.js";
import { ExpectedToolCall, parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "./accuracy-scorers.js";
import { Agent, getVercelToolCallingAgent } from "./agent.js";
import { appendAccuracySnapshot } from "./accuracy-snapshot.js";

export interface AccuracyTestConfig {
    systemPrompt?: string;
    injectConnectedAssumption?: boolean;
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
    const accuracyCommit = process.env.MDB_ACCURACY_COMMIT;

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
            const toolsForModel = testTools.vercelAiTools();
            const promptForModel = testConfig.injectConnectedAssumption
                ? [testConfig.prompt, "(Assume that you are already connected to a MongoDB cluster!)"].join(" ")
                : testConfig.prompt;
            const conversation = await agent.prompt(promptForModel, model, toolsForModel);
            const toolCalls = testTools.getToolCalls();
            const toolCallingAccuracy = toolCallingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
            const parameterMatchingAccuracy = parameterMatchingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
            console.debug(`Conversation`, JSON.stringify(conversation, null, 2));
            console.debug(`Tool calls`, JSON.stringify(toolCalls, null, 2));
            console.debug(
                "Tool calling accuracy: %s, Parameter Accuracy: %s",
                toolCallingAccuracy,
                parameterMatchingAccuracy
            );
            if (accuracyDatetime && accuracyCommit) {
                await appendAccuracySnapshot({
                    datetime: accuracyDatetime,
                    commit: accuracyCommit,
                    model: model.modelName,
                    suite: suiteName,
                    test: testConfig.prompt,
                    toolCallingAccuracy,
                    parameterAccuracy: parameterMatchingAccuracy,
                });
            } else {
                console.info(
                    `Skipping accuracy snapshot update for ${model.modelName} - ${suiteName} - ${testConfig.prompt}`
                );
            }
        });
    });
}
