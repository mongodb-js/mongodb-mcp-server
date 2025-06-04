import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { getResponseElements, getParameters, expectDefined } from "../../../helpers.js";

describeWithMongoDB("listDatabases tool", (integration) => {
    const defaultDatabases = ["admin", "config", "local"];

    it("should have correct metadata", async () => {
        const { tools } = await integration.mcpClient().listTools();
        const listDatabases = tools.find((tool) => tool.name === "list-databases");
        expectDefined(listDatabases);
        expect(listDatabases.description).toBe("List all databases for a MongoDB connection");

        const parameters = getParameters(listDatabases);
        expect(parameters).toHaveLength(0);
    });

    describe("with no preexisting databases", () => {
        it("returns only the system databases", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().callTool({ name: "list-databases", arguments: {} });
            const dbNames = getDbNames(response.content);

            expect(defaultDatabases).toIncludeAllMembers(dbNames);
        });
    });

    describe("with preexisting databases", () => {
        it("returns their names and sizes", async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient.db("foo").collection("bar").insertOne({ test: "test" });
            await mongoClient.db("baz").collection("qux").insertOne({ test: "test" });

            await integration.connectMcpClient();

            const response = await integration.mcpClient().callTool({ name: "list-databases", arguments: {} });
            const dbNames = getDbNames(response.content);
            expect(dbNames).toIncludeSameMembers([...defaultDatabases, "foo", "baz"]);
        });
    });

    validateAutoConnectBehavior(
        integration,
        "list-databases",
        () => {
            return {
                args: {},
                validate: (content) => {
                    const dbNames = getDbNames(content);

                    expect(defaultDatabases).toIncludeAllMembers(dbNames);
                },
            };
        },
        async () => {
            const mongoClient = integration.mongoClient();
            const { databases } = await mongoClient.db("admin").command({ listDatabases: 1, nameOnly: true });
            for (const db of databases as { name: string }[]) {
                if (!defaultDatabases.includes(db.name)) {
                    await mongoClient.db(db.name).dropDatabase();
                }
            }
        }
    );
});

function getDbNames(content: unknown): (string | null)[] {
    const responseItems = getResponseElements(content);
    return responseItems
        .map((item) => {
            if (item && typeof item.text === "string") {
                const match = item.text.match(/Name: ([^,]+), Size: \d+ bytes/);
                return match ? match[1] : null;
            }
            return null;
        })
        .filter((item): item is string | null => item !== undefined);
}
