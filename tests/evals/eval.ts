import { Eval } from "braintrust";
import { getAvailableModels, Model } from "../accuracy/sdk/models.js";
import { TestTools } from "../accuracy/sdk/test-tools.js";
import { getVercelToolCallingAgent } from "../accuracy/sdk/agent.js";
import { parameterMatchingAccuracyScorer, toolCallingAccuracyScorer } from "../accuracy/sdk/accuracy-scorers.js";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { listDatabasesTests } from "./tests/list-databases.eval.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports
const mcpTools = require("../../mcp-tools.json");

void Eval(listDatabasesTests.evalName, {
    projectId: process.env.BRAIN_TRUST_PROJECT_ID,
    data: listDatabasesTests.testConfigs.map((testConfig) => ({
        input: testConfig.prompt,
        expected: testConfig.expectedToolCalls,
        metadata: {
            mockedTools: testConfig.mockedTools,
        },
    })),
    task: async (input, { metadata }) => {
        const testTools = new TestTools(mcpTools as Tool[]);
        testTools.mockTools(metadata.mockedTools);
        const agent = getVercelToolCallingAgent();
        const models = getAvailableModels();
        const model = models[0] as Model;
        const conversation = await agent.prompt(input, model, testTools.vercelAiTools());
        return {
            conversation,
            toolCalls: testTools.getToolCalls(),
        };
    },
    scores: [
        function toolCallingAccuracy({ output, expected }): number {
            return toolCallingAccuracyScorer(expected, output.toolCalls);
        },
        function parameterPassingAccuracy({ output, expected }): number {
            return parameterMatchingAccuracyScorer(expected, output.toolCalls);
        },
    ],
});
