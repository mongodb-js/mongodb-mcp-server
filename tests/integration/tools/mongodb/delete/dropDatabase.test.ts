import { describeMongoDB } from "../mongodbHelpers.js";

import {
    getResponseContent,
    dbOperationParameters,
    setupIntegrationTest,
    validateToolMetadata,
    validateAutoConnectBehavior,
    validateThrowsForInvalidArguments,
    dbOperationInvalidArgTests,
} from "../../../helpers.js";

describeMongoDB("dropDatabase tool", (integration) => {
    validateToolMetadata(
        integration,
        "drop-database",
        "Removes the specified database, deleting the associated data files",
        [dbOperationParameters.find((d) => d.name === "database")!]
    );

    validateThrowsForInvalidArguments(integration, "drop-database", dbOperationInvalidArgTests);

    it("can drop non-existing database", async () => {
        let { databases } = await integration.mongoClient().db("").admin().listDatabases();

        const preDropLength = databases.length;

        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "drop-database",
            arguments: {
                database: integration.randomDbName(),
            },
        });

        const content = getResponseContent(response.content);
        expect(content).toContain(`Successfully dropped database "${integration.randomDbName()}"`);

        ({ databases } = await integration.mongoClient().db("").admin().listDatabases());

        expect(databases).toHaveLength(preDropLength);
        expect(databases.find((db) => db.name === integration.randomDbName())).toBeUndefined();
    });

    it("removes the database along with its collections", async () => {
        await integration.connectMcpClient();
        await integration.mongoClient().db(integration.randomDbName()).createCollection("coll1");
        await integration.mongoClient().db(integration.randomDbName()).createCollection("coll2");

        let { databases } = await integration.mongoClient().db("").admin().listDatabases();
        expect(databases.find((db) => db.name === integration.randomDbName())).toBeDefined();

        const response = await integration.mcpClient().callTool({
            name: "drop-database",
            arguments: {
                database: integration.randomDbName(),
            },
        });
        const content = getResponseContent(response.content);
        expect(content).toContain(`Successfully dropped database "${integration.randomDbName()}"`);

        ({ databases } = await integration.mongoClient().db("").admin().listDatabases());
        expect(databases.find((db) => db.name === integration.randomDbName())).toBeUndefined();

        const collections = await integration.mongoClient().db(integration.randomDbName()).listCollections().toArray();
        expect(collections).toHaveLength(0);
    });

    validateAutoConnectBehavior(
        integration,
        "drop-database",
        () => {
            return {
                args: { database: integration.randomDbName() },
                expectedResponse: `Successfully dropped database "${integration.randomDbName()}"`,
            };
        },
        async () => {
            await integration.mongoClient().db(integration.randomDbName()).createCollection("coll1");
        }
    );
});
