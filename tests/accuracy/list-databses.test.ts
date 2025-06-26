import { jest } from "@jest/globals";
import { AccuracyTestMcpClient } from "./sdk/test-mcp-client.js";
import { discoverMongoDBMCPTools, eachModel } from "./test-setup.js";

const eachPrompt = describe.each([
    "how many databases in my clusters?",
    "list all the databases that I have",
    "count number of databases in my cluster",
]);

eachModel("%s - list-databases", function (model) {
    let testMCPClient: AccuracyTestMcpClient;
    beforeAll(async () => {
        const tools = await discoverMongoDBMCPTools();
        testMCPClient = new AccuracyTestMcpClient(tools);
    });

    beforeEach(() => {
        jest.resetAllMocks();
    });

    eachPrompt("Prompt - %s", function (prompt) {
        it("should call list-databases tool", async function () {
            const listDatabasesMock = testMCPClient.getMockedToolFn("list-databases").mockReturnValueOnce({
                content: [
                    {
                        type: "text",
                        text: "Name: artworks, Size: 1024 bytes",
                    },
                ],
            });
            await model.chat(prompt, testMCPClient);
            expect(listDatabasesMock).toHaveBeenCalledOnce();
        });
    });
});
