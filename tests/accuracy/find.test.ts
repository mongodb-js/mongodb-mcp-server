import { AccuracyTestMcpClient } from "./sdk/test-mcp-client.js";
import { discoverMongoDBMCPTools, eachModel } from "./test-setup.js";

eachModel("%s - find", function (model) {
    let testMCPClient: AccuracyTestMcpClient;
    beforeAll(async () => {
        const tools = await discoverMongoDBMCPTools();
        testMCPClient = new AccuracyTestMcpClient(tools);
    });

    beforeEach(() => {
        testMCPClient.resetMocks();
    });

    it.each([
        {
            prompt: "find all users in my mongodb database 'my' and collection 'users'",
            db: "my",
            collection: "users",
        },
        {
            prompt: "find all red cars in database 'production' and collection 'cars'",
            db: "production",
            collection: "cars",
        },
    ])("should call find tool for prompt: '$prompt'", async function (testCase) {
        testMCPClient.getMockedToolFn("find").mockReturnValue({
            content: [
                {
                    type: "text",
                    text: `Found 1 documents in the collection "users":`,
                },
                {
                    type: "text",
                    text: JSON.stringify({ name: "Happy puppy!" }),
                },
            ],
        });
        await model.chat(testCase.prompt, testMCPClient);
        expect(testMCPClient.getMockedToolFn("find")).toHaveBeenCalledWith(
            expect.objectContaining({
                database: testCase.db,
                collection: testCase.collection,
            })
        );
    });

    it.each([
        {
            prompt: "find first 10 books in database 'prod' and collection 'books' where the author is J.R.R Tolkien",
            db: "prod",
            collection: "books",
        },
    ])("should call find tool with filter for prompt: '$prompt'", async function (testCase) {
        testMCPClient.getMockedToolFn("find").mockReturnValue({
            content: [
                {
                    type: "text",
                    text: `Found 1 documents in the collection "users":`,
                },
                {
                    type: "text",
                    text: JSON.stringify({ name: "Happy puppy!" }),
                },
            ],
        });
        expect(testMCPClient.getMockedToolFn("find")).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                database: testCase.db,
                collection: testCase.collection,
                filter: { author: "J.R.R Tolkien" },
                limit: 10,
            })
        );
    });
});
