import { describeWithMongoDB, validateAutoConnectBehavior } from "../mongodbHelpers.js";
import { expect, it } from "vitest";

import {
    getResponseContent,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseParameters,
    databaseInvalidArgs,
    expectDefined,
} from "../../../helpers.js";

describeWithMongoDB("dropDatabase tool", (integration) => {
    validateToolMetadata(
        integration,
        "drop-database",
        "Removes the specified database, deleting the associated data files",
        databaseParameters
    );

    validateThrowsForInvalidArguments(integration, "drop-database", databaseInvalidArgs);

    it("can drop non-existing database", async () => {
        let { databases } = await integration.mongoClient().db("").admin().listDatabases();

        expect(databases.find((db) => db.name === integration.randomDbName())).toBeUndefined();

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

        expect(databases.find((db) => db.name === integration.randomDbName())).toBeUndefined();
    });

    it("removes the database along with its collections", async () => {
        await integration.connectMcpClient();
        await integration.mongoClient().db(integration.randomDbName()).createCollection("coll1");
        await integration.mongoClient().db(integration.randomDbName()).createCollection("coll2");

        let { databases } = await integration.mongoClient().db("").admin().listDatabases();
        expectDefined(databases.find((db) => db.name === integration.randomDbName()));

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
