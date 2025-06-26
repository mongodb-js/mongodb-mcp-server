import { AccuracyTestMcpClient } from "./sdk/test-mcp-client.js";
import { discoverMongoDBMCPTools, eachModel } from "./test-setup.js";

eachModel("%s - delete-many", function (model) {
    let testMCPClient: AccuracyTestMcpClient;
    beforeAll(async () => {
        const tools = await discoverMongoDBMCPTools();
        testMCPClient = new AccuracyTestMcpClient(tools);
    });

    beforeEach(() => {
        testMCPClient.resetMocks();
    });

    it("should delete documents from a collection", async function () {
        const prompt =
            'Assuming a collection "users" in database "my", delete all documents where the username is "john_doe".';

        const deleteManyMock = testMCPClient.getMockedToolFn("delete-many").mockReturnValue({
            content: [
                {
                    text: `Delete operation successful: 1 document(s) deleted from collection "users"`,
                    type: "text",
                },
            ],
        });

        await model.chat(prompt, testMCPClient);
        expect(deleteManyMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                database: "my",
                collection: "users",
                filter: {
                    username: "john_doe",
                },
            })
        );
    });
});
