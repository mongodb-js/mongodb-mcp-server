import { getResponseElements, connect, jestTestCluster, jestTestMCPClient } from "../../../helpers.js";
import { MongoClient } from "mongodb";
import { toIncludeSameMembers } from "jest-extended";

describe("listDatabases tool", () => {
    const client = jestTestMCPClient();
    const cluster = jestTestCluster();

    it("should have correct metadata", async () => {
        const { tools } = await client().listTools();
        const listDatabases = tools.find((tool) => tool.name === "list-databases")!;
        expect(listDatabases).toBeDefined();
        expect(listDatabases.description).toBe("List all databases for a MongoDB connection");
        expect(listDatabases.inputSchema.type).toBe("object");
        expect(listDatabases.inputSchema.properties).toBeDefined();

        const propertyNames = Object.keys(listDatabases.inputSchema.properties!);
        expect(propertyNames).toHaveLength(0);
    });

    describe("with no preexisting databases", () => {
        it("returns only the system databases", async () => {
            await connect(client(), cluster());
            const response = await client().callTool({ name: "list-databases", arguments: {} });
            const dbNames = getDbNames(response.content);

            expect(dbNames).toIncludeSameMembers(["admin", "config", "local"]);
        });
    });

    describe("with preexisting databases", () => {
        it("returns their names and sizes", async () => {
            const mongoClient = new MongoClient(cluster().connectionString);
            await mongoClient.db("foo").collection("bar").insertOne({ test: "test" });
            await mongoClient.db("baz").collection("qux").insertOne({ test: "test" });
            await mongoClient.close();

            await connect(client(), cluster());

            const response = await client().callTool({ name: "list-databases", arguments: {} });
            const dbNames = getDbNames(response.content);
            expect(dbNames).toIncludeSameMembers(["admin", "config", "local", "foo", "baz"]);
        });
    });
});

function getDbNames(content: unknown): (string | null)[] {
    const responseItems = getResponseElements(content);

    return responseItems.map((item) => {
        const match = item.text.match(/Name: (.*), Size: \d+ bytes/);
        return match ? match[1] : null;
    });
}
