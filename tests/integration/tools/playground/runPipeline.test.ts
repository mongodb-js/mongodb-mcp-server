import { jest } from "@jest/globals";
import { describeWithMongoDB } from "../mongodb/mongodbHelpers.js";
import { getResponseElements } from "../../helpers.js";
import { PlaygroundRunError } from "../../../../src/common/playground/playgroundClient.js";

const setupMockPlaygroundClient = (implementation: unknown) => {
    // mock ESM modules https://jestjs.io/docs/ecmascript-modules#module-mocking-in-esm
    jest.unstable_mockModule("../../../../src/common/playground/playgroundClient.js", () => ({
        PlaygroundClient: implementation,
    }));
};

describeWithMongoDB("runPipeline tool", (integration) => {
    beforeEach(() => {
        jest.resetModules();
    });

    it("should return results", async () => {
        class PlaygroundClientMock {
            run = () => ({
                documents: [{ name: "First document" }],
            });
        }
        setupMockPlaygroundClient(PlaygroundClientMock);

        const response = await integration.mcpClient().callTool({
            name: "run-pipeline",
            arguments: {
                documents: [{ name: "First document" }, { name: "Second document" }],
                aggregationPipeline: [
                    {
                        $search: {
                            index: "default",
                            text: {
                                query: "first",
                                path: {
                                    wildcard: "*",
                                },
                            },
                        },
                    },
                ],
            },
        });
        const elements = getResponseElements(response.content);
        expect(elements).toEqual([
            {
                text: 'Found 1 documents":',
                type: "text",
            },
            {
                text: '{"name":"First document"}',
                type: "text",
            },
        ]);
    });

    it("should return error", async () => {
        class PlaygroundClientMock {
            run = () => {
                throw new PlaygroundRunError("Test error message", "TEST_CODE");
            };
        }
        setupMockPlaygroundClient(PlaygroundClientMock);

        const response = await integration.mcpClient().callTool({
            name: "run-pipeline",
            arguments: {
                documents: [],
                aggregationPipeline: [],
            },
        });
        expect(response.content).toEqual([
            {
                type: "text",
                text: "Error running run-pipeline: Error code: TEST_CODE. Error message: Test error message.",
            },
        ]);
    });
});
