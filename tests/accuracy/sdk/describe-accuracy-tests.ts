import { TestableModels } from "./models.js";
import { calculateToolCallingAccuracy } from "./accuracy-scorers.js";
import { getVercelToolCallingAgent, VercelAgent } from "./agent.js";
import { prepareTestData, setupMongoDBIntegrationTest } from "../../integration/tools/mongodb/mongodbHelpers.js";
import { AccuracyTestingClient, MockedTools } from "./accuracy-testing-client.js";
import { getAccuracySnapshotStorage } from "./accuracy-snapshot-storage/get-snapshot-storage.js";
import { AccuracySnapshotStorage, ExpectedToolCall } from "./accuracy-snapshot-storage/snapshot-storage.js";

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

    eachModel(`$displayName`, function (model) {
        const mdbIntegration = setupMongoDBIntegrationTest();
        const { populateTestData, cleanupTestDatabases } = prepareTestData(mdbIntegration);

        let accuracySnapshotStorage: AccuracySnapshotStorage;
        let testMCPClient: AccuracyTestingClient;
        let agent: VercelAgent;

        beforeAll(async () => {
            accuracySnapshotStorage = await getAccuracySnapshotStorage();
            testMCPClient = await AccuracyTestingClient.initializeClient(mdbIntegration.connectionString());
            agent = getVercelToolCallingAgent();
        });

        beforeEach(async () => {
            await cleanupTestDatabases(mdbIntegration);
            await populateTestData();
            testMCPClient.resetForTests();
        });

        afterAll(async () => {
            await accuracySnapshotStorage.close();
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

                const timeBeforePrompt = Date.now();
                const result = await agent.prompt(promptForModel, model, toolsForModel);
                const timeAfterPrompt = Date.now();
                const toolCalls = testMCPClient.getToolCalls();
                const toolCallingAccuracy = calculateToolCallingAccuracy(testConfig.expectedToolCalls, toolCalls);

                const responseTime = timeAfterPrompt - timeBeforePrompt;
                await accuracySnapshotStorage.createSnapshotEntry({
                    provider: model.provider,
                    requestedModel: model.modelName,
                    test: suiteName,
                    prompt: testConfig.prompt,
                    llmResponseTime: responseTime,
                    toolCallingAccuracy: toolCallingAccuracy,
                    actualToolCalls: toolCalls,
                    expectedToolCalls: testConfig.expectedToolCalls,
                    ...result,
                });
            });
        });
    });
}
