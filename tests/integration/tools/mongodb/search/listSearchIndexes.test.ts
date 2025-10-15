import type { Collection } from "mongodb";
import { describeWithMongoDB, getSingleDocFromUntrustedContent } from "../mongodbHelpers.js";
import { describe, it, expect, beforeEach } from "vitest";
import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
    getDataFromUntrustedContent,
    waitUntilSearchManagementServiceIsReady,
    waitUntilSearchIndexIsQueryable,
} from "../../../helpers.js";
import type { SearchIndexWithStatus } from "../../../../../src/tools/mongodb/search/listSearchIndexes.js";

const SEARCH_TIMEOUT = 20_000;

describeWithMongoDB("list-search-indexes tool in local MongoDB", (integration) => {
    validateToolMetadata(
        integration,
        "list-search-indexes",
        "Describes the search and vector search indexes for a single collection",
        databaseCollectionParameters
    );

    validateThrowsForInvalidArguments(integration, "list-search-indexes", databaseCollectionInvalidArgs);

    it("fails for clusters without MongoDB Search", async () => {
        await integration.connectMcpClient();
        const response = await integration.mcpClient().callTool({
            name: "list-search-indexes",
            arguments: { database: "any", collection: "foo" },
        });
        const content = getResponseContent(response.content);
        expect(response.isError).toBe(true);
        expect(content).toEqual(
            "This MongoDB cluster does not support Search Indexes. Make sure you are using an Atlas Cluster, either remotely in Atlas or using the Atlas Local image, or your cluster supports MongoDB Search."
        );
    });
});

describeWithMongoDB(
    "list-search-indexes tool in Atlas",
    (integration) => {
        let fooCollection: Collection;

        beforeEach(async () => {
            await integration.connectMcpClient();
            fooCollection = integration.mongoClient().db("any").collection("foo");
            await waitUntilSearchManagementServiceIsReady(fooCollection, SEARCH_TIMEOUT);
        });

        describe("when the collection does not exist", () => {
            it("returns an empty list of indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "list-search-indexes",
                    arguments: { database: "any", collection: "foo" },
                });
                const responseContent = getResponseContent(response.content);
                const content = getDataFromUntrustedContent(responseContent);
                expect(responseContent).toContain("Could not retrieve search indexes");
                expect(content).toEqual("There are no search or vector search indexes in any.foo");
            });
        });

        describe("when there are no indexes", () => {
            it("returns an empty list of indexes", async () => {
                const response = await integration.mcpClient().callTool({
                    name: "list-search-indexes",
                    arguments: { database: "any", collection: "foo" },
                });
                const responseContent = getResponseContent(response.content);
                const content = getDataFromUntrustedContent(responseContent);
                expect(responseContent).toContain("Could not retrieve search indexes");
                expect(content).toEqual("There are no search or vector search indexes in any.foo");
            });
        });

        describe("when there are indexes", () => {
            beforeEach(async () => {
                await fooCollection.insertOne({ field1: "yay" });
                await waitUntilSearchManagementServiceIsReady(fooCollection, SEARCH_TIMEOUT);
                await fooCollection.createSearchIndexes([{ definition: { mappings: { dynamic: true } } }]);
            });

            it("returns the list of existing indexes", { timeout: SEARCH_TIMEOUT }, async () => {
                const response = await integration.mcpClient().callTool({
                    name: "list-search-indexes",
                    arguments: { database: "any", collection: "foo" },
                });
                const content = getResponseContent(response.content);
                const indexDefinition = getSingleDocFromUntrustedContent<SearchIndexWithStatus>(content);

                expect(indexDefinition?.name).toEqual("default");
                expect(indexDefinition?.type).toEqual("search");
                expect(indexDefinition?.latestDefinition).toEqual({ mappings: { dynamic: true, fields: {} } });
            });

            it(
                "returns the list of existing indexes and detects if they are queryable",
                { timeout: SEARCH_TIMEOUT },
                async () => {
                    await waitUntilSearchIndexIsQueryable(fooCollection, "default", SEARCH_TIMEOUT);

                    const response = await integration.mcpClient().callTool({
                        name: "list-search-indexes",
                        arguments: { database: "any", collection: "foo" },
                    });

                    const content = getResponseContent(response.content);
                    const indexDefinition = getSingleDocFromUntrustedContent<SearchIndexWithStatus>(content);

                    expect(indexDefinition?.name).toEqual("default");
                    expect(indexDefinition?.type).toEqual("search");
                    expect(indexDefinition?.latestDefinition).toEqual({ mappings: { dynamic: true, fields: {} } });
                    expect(indexDefinition?.queryable).toEqual(true);
                    expect(indexDefinition?.status).toEqual("READY");
                }
            );
        });
    },
    {
        downloadOptions: { search: true },
    }
);
