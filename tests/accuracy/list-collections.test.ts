import { jest } from "@jest/globals";
import { AccuracyTestMcpClient } from "./sdk/test-mcp-client.js";
import { discoverMongoDBMCPTools, eachModel } from "./test-setup.js";

eachModel("%s - list-collections", function (model) {
    let testMCPClient: AccuracyTestMcpClient;
    beforeAll(async () => {
        const tools = await discoverMongoDBMCPTools();
        testMCPClient = new AccuracyTestMcpClient(tools);
    });

    beforeEach(() => {
        jest.resetAllMocks();
    });

    it.each([
        "how many collections are in sample_mflix database in my clusters?",
        "list all the collections from the sample_mflix database in my cluster",
    ])("should call list-collections tool for prompt: %s", async function (prompt) {
        const listCollectionsMock = testMCPClient.getMockedToolFn("list-collections").mockReturnValueOnce({
            content: [
                {
                    text: `Name: "arts"`,
                    type: "text",
                },
            ],
        });

        await model.chat(prompt, testMCPClient);
        expect(listCollectionsMock).toHaveBeenCalledWith({ database: "sample_mflix" });
    });

    it.each([
        [
            "How many databases are there in my cluster?",
            "If there is a sample_mflix database then how many collections in that database?",
        ].join("\n"),
    ])("should call first list-databses and then list-collections tool for prompt: %s", async function (prompt) {
        const listDatabasesMock = testMCPClient.getMockedToolFn("list-databases").mockReturnValueOnce({
            content: [
                {
                    type: "text",
                    text: "Name: sample_mflix, Size: 1024 bytes",
                },
            ],
        });
        const listCollectionsMock = testMCPClient.getMockedToolFn("list-collections").mockReturnValueOnce({
            content: [
                {
                    text: `Name: "movies"`,
                    type: "text",
                },
            ],
        });

        await model.chat(prompt, testMCPClient);
        expect(listDatabasesMock).toHaveBeenCalled();
        expect(listCollectionsMock).toHaveBeenCalledWith({ database: "sample_mflix" });
    });
});
