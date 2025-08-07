import { describe, it, beforeAll, beforeEach, afterAll } from "vitest";
import { getAvailableModels } from "./models.js";
import { calculateToolCallingAccuracy } from "./accuracyScorer.js";
import { getVercelToolCallingAgent, VercelAgent } from "./agent.js";
import { prepareTestData, setupMongoDBIntegrationTest } from "../../integration/tools/mongodb/mongodbHelpers.js";
import { AccuracyTestingClient, MockedTools } from "./accuracyTestingClient.js";
import { AccuracyResultStorage, ExpectedToolCall } from "./accuracyResultStorage/resultStorage.js";
import { getAccuracyResultStorage } from "./accuracyResultStorage/getAccuracyResultStorage.js";
import { getCommitSHA } from "./gitInfo.js";

export interface AccuracyTestConfig {
    /** The prompt to be provided to LLM for evaluation. */
    prompt: string;

    /**
     * A list of tools and their parameters that we expect LLM to call based on
     * how vague or detailed the prompt is. Ideally this should be a list of
     * bare minimum and critical tool calls that are required to solve the
     * problem mentioned in the prompt but because, for even a slightly vague
     * prompt, LLM might decide to do additional confirmation by calling other
     * tools, its fine to include those other tool calls as well to get a
     * perfect 1 on the tool calling accuracy score. */
    expectedToolCalls: ExpectedToolCall[];

    /**
     * The additional system prompt to be appended to already injected system
     * prompt. */
    systemPrompt?: string;

    /**
     * A small hint appended to the actual prompt in test, which is supposed to
     * hint LLM to assume that the MCP server is already connected so that it
     * does not call the connect tool.
     * By default it is assumed to be true */
    injectConnectedAssumption?: boolean;

    /**
     * A map of tool names to their mocked implementation. When the mocked
     * implementations are available, the testing client will prefer those over
     * actual MCP tool calls. */
    mockedTools?: MockedTools;
}

export function describeAccuracyTests(accuracyTestConfigs: AccuracyTestConfig[]): void {
    if (!process.env.MDB_ACCURACY_RUN_ID) {
        throw new Error("MDB_ACCURACY_RUN_ID env variable is required for accuracy test runs!");
    }

    const models = getAvailableModels();
    if (!models.length) {
        throw new Error("No models available to test. Ensure that the API keys are properly setup!");
    }

    const eachModel = describe.each(models);

    eachModel(`$displayName`, function (model) {
        const accuracyRunId = `${process.env.MDB_ACCURACY_RUN_ID}`;
        const mdbIntegration = setupMongoDBIntegrationTest();
        const { populateTestData, cleanupTestDatabases } = prepareTestData(mdbIntegration);

        let commitSHA: string;
        let accuracyResultStorage: AccuracyResultStorage;
        let testMCPClient: AccuracyTestingClient;
        let agent: VercelAgent;

        beforeAll(async () => {
            const retrievedCommitSHA = await getCommitSHA();
            if (!retrievedCommitSHA) {
                throw new Error("Could not derive commitSHA, exiting accuracy tests!");
            }
            commitSHA = retrievedCommitSHA;

            accuracyResultStorage = getAccuracyResultStorage();
            testMCPClient = await AccuracyTestingClient.initializeClient(mdbIntegration.connectionString());
            agent = getVercelToolCallingAgent();
        });

        beforeEach(async () => {
            await cleanupTestDatabases(mdbIntegration);
            await populateTestData();
            testMCPClient.resetForTests();
        });

        afterAll(async () => {
            await accuracyResultStorage?.close();
            await testMCPClient?.close();
        });

        const eachTest = it.each(accuracyTestConfigs);

        eachTest("$prompt", async function (testConfig) {
            testMCPClient.mockTools(testConfig.mockedTools ?? {});
            const toolsForModel = await testMCPClient.vercelTools();
            const promptForModel =
                testConfig.injectConnectedAssumption === false
                    ? testConfig.prompt
                    : [testConfig.prompt, "(Assume that you are already connected to a MongoDB cluster!)"].join(" ");

            const timeBeforePrompt = Date.now();
            const result = await agent.prompt(promptForModel, model, toolsForModel);
            const timeAfterPrompt = Date.now();

            const llmToolCalls = testMCPClient.getLLMToolCalls();
            const toolCallingAccuracy = calculateToolCallingAccuracy(testConfig.expectedToolCalls, llmToolCalls);

            const responseTime = timeAfterPrompt - timeBeforePrompt;
            await accuracyResultStorage.saveModelResponseForPrompt({
                commitSHA,
                runId: accuracyRunId,
                prompt: testConfig.prompt,
                expectedToolCalls: testConfig.expectedToolCalls,
                modelResponse: {
                    provider: model.provider,
                    requestedModel: model.modelName,
                    respondingModel: result.respondingModel,
                    llmResponseTime: responseTime,
                    toolCallingAccuracy: toolCallingAccuracy,
                    llmToolCalls: llmToolCalls,
                    tokensUsed: result.tokensUsage,
                    text: result.text,
                    messages: result.messages,
                },
            });
        });
    });
}
