import { AccuracyTestMcpClient } from "./sdk/test-mcp-client.js";
import { discoverMongoDBMCPTools, eachModel } from "./test-setup.js";

eachModel("%s - insert-many", function (model) {
    let testMCPClient: AccuracyTestMcpClient;
    beforeAll(async () => {
        const tools = await discoverMongoDBMCPTools();
        testMCPClient = new AccuracyTestMcpClient(tools);
    });

    beforeEach(() => {
        testMCPClient.resetMocks();
    });

    it("should first call create-collection then insert-data tool", async function () {
        const prompt = [
            'create a new collection named "users" in database "my" and afterwards create a sample document with the following data:',
            '- username: "john_doe"',
            "- email: test@mongodb.com",
            '- password: "password123"',
            "- disabled: false",
        ].join("\n");

        const createCollectionMock = testMCPClient.getMockedToolFn("create-collection").mockReturnValue({
            content: [
                {
                    type: "text",
                    text: `Collection "users" created in database "my".`,
                },
            ],
        });

        const insertManyMock = testMCPClient.getMockedToolFn("insert-many").mockReturnValue({
            content: [
                {
                    text: `Inserted 1 document(s) into collection "users"`,
                    type: "text",
                },
                {
                    text: `Inserted IDs: 1FOO`,
                    type: "text",
                },
            ],
        });

        await model.chat(prompt, testMCPClient);
        expect(createCollectionMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                database: "my",
                collection: "users",
            })
        );
        expect(insertManyMock).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                database: "my",
                collection: "users",
                documents: [
                    {
                        username: "john_doe",
                        email: "test@mongodb.com",
                        password: "password123",
                        disabled: false,
                    },
                ],
            })
        );
    });
});
