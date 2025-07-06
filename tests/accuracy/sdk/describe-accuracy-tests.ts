import { TestableModels } from "./models.js";
import { ExpectedToolCall, parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "./accuracy-scorers.js";
import { Agent, getVercelToolCallingAgent } from "./agent.js";
import { prepareTestData, setupMongoDBIntegrationTest } from "../../integration/tools/mongodb/mongodbHelpers.js";
import { AccuracyTestingClient, MockedTools } from "./accuracy-testing-client.js";

export interface AccuracyTestConfig {
    systemPrompt?: string;
    injectConnectedAssumption?: boolean;
    prompt: string;
    expectedToolCalls: ExpectedToolCall[];
    mockedTools: MockedTools;
}

export function describeSuite(suiteName: string, testConfigs: AccuracyTestConfig[]) {
    return {
        [suiteName]: testConfigs,
    };
}

export function describeAccuracyTests(
    models: TestableModels,
    accuracyTestConfigs: {
        [suiteName: string]: AccuracyTestConfig[];
    }
) {
    if (!models.length) {
        throw new Error("No models available to test!");
    }

    const eachModel = describe.each(models);
    const eachSuite = describe.each(Object.keys(accuracyTestConfigs));

    eachModel(`$modelName`, function (model) {
        const mdbIntegration = setupMongoDBIntegrationTest();
        const populateTestData = prepareTestData(mdbIntegration);

        let testMCPClient: AccuracyTestingClient;
        let agent: Agent;

        beforeAll(async () => {
            testMCPClient = await AccuracyTestingClient.initializeClient(mdbIntegration.connectionString());
            agent = getVercelToolCallingAgent();
        });

        beforeEach(async () => {
            await populateTestData();
            testMCPClient.resetForTests();
        });

        afterAll(async () => {
            await testMCPClient.close();
        });

        eachSuite("%s", function (suiteName) {
            const eachTest = it.each(accuracyTestConfigs[suiteName] ?? []);

            eachTest("$prompt", async function (testConfig) {
                testMCPClient.mockTools(testConfig.mockedTools);
                const toolsForModel = await testMCPClient.vercelTools();
                const promptForModel = testConfig.injectConnectedAssumption
                    ? [testConfig.prompt, "(Assume that you are already connected to a MongoDB cluster!)"].join(" ")
                    : testConfig.prompt;
                const conversation = await agent.prompt(promptForModel, model, toolsForModel);
                const toolCalls = testMCPClient.getToolCalls();
                const toolCallingAccuracy = toolCallingAccuracyScorer(testConfig.expectedToolCalls, toolCalls);
                const parameterMatchingAccuracy = parameterMatchingAccuracyScorer(
                    testConfig.expectedToolCalls,
                    toolCalls
                );
                console.debug(testConfig.prompt);
                // console.debug(`Conversation`, JSON.stringify(conversation, null, 2));
                // console.debug(`Tool calls`, JSON.stringify(toolCalls, null, 2));
                console.debug(
                    "Tool calling accuracy: %s, Parameter Accuracy: %s",
                    toolCallingAccuracy,
                    parameterMatchingAccuracy
                );
            });
        });
    });
}
