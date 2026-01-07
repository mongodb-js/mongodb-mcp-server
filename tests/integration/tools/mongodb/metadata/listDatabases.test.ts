import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { getResponseElements, getParameters, expectDefined, getDataFromUntrustedContent } from "../../../helpers.js";
import { describe, expect, it } from "vitest";
import type { ListDatabasesOutput } from "../../../../../src/tools/mongodb/metadata/listDatabases.js";

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

            expect(dbNames).toIncludeSameMembers(defaultDatabases);

            const structuredContent = response.structuredContent as ListDatabasesOutput;
            expect(structuredContent.databases.map((db) => db.name)).toIncludeSameMembers(defaultDatabases);
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

            const structuredContent = response.structuredContent as ListDatabasesOutput;
            expect(structuredContent.databases.map((db) => db.name)).toIncludeSameMembers([
                ...defaultDatabases,
                "foo",
                "baz",
            ]);
        });
    });

    validateAutoConnectBehavior(
        integration,
        "list-databases",
        () => {
            return {
                args: {},
                validate: (content): void => {
                    const dbNames = getDbNames(content);

                    expect(defaultDatabases).toStrictEqual(dbNames);
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
    expect(responseItems).toHaveLength(2);
    const data = getDataFromUntrustedContent(responseItems[1]?.text ?? "{}");
    return (JSON.parse(data) as ListDatabasesOutput).databases.map((db) => db.name);
}
