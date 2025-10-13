import {
    describeWithMongoDB,
    getSingleDocFromUntrustedContent,
    waitUntilSearchIndexIsQueryable,
    waitUntilSearchIsReady,
} from "../mongodbHelpers.js";
import { describe, it, expect, beforeEach } from "vitest";
import {
    getResponseContent,
    databaseCollectionParameters,
    validateToolMetadata,
    validateThrowsForInvalidArguments,
    databaseCollectionInvalidArgs,
    getDataFromUntrustedContent,
} from "../../../helpers.js";
import type { NodeDriverServiceProvider } from "@mongosh/service-provider-node-driver";
import type { SearchIndexStatus } from "../../../../../src/tools/mongodb/search/listSearchIndexes.js";

const SEARCH_TIMEOUT = 20_000;

describeWithMongoDB("list search indexes tool in local MongoDB", (integration) => {
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
        expect(content).toEqual(
            "This MongoDB cluster does not support Search Indexes. Make sure you are using an Atlas Cluster, either remotely in Atlas or using the Atlas Local image, or your cluster supports MongoDB Search."
        );
    });
});

describeWithMongoDB(
    "list search indexes tool in Atlas",
    (integration) => {
        let provider: NodeDriverServiceProvider;

        beforeEach(async ({ signal }) => {
            await integration.connectMcpClient();
            provider = integration.mcpServer().session.serviceProvider;
            await waitUntilSearchIsReady(provider, signal);
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
                await provider.insertOne("any", "foo", { field1: "yay" });
                await provider.createSearchIndexes("any", "foo", [{ definition: { mappings: { dynamic: true } } }]);
            });

            it("returns the list of existing indexes", { timeout: SEARCH_TIMEOUT }, async () => {
                const response = await integration.mcpClient().callTool({
                    name: "list-search-indexes",
                    arguments: { database: "any", collection: "foo" },
                });
                const content = getResponseContent(response.content);
                const indexDefinition = getSingleDocFromUntrustedContent<SearchIndexStatus>(content);

                expect(indexDefinition?.name).toEqual("default");
                expect(indexDefinition?.type).toEqual("search");
                expect(indexDefinition?.latestDefinition).toEqual({ mappings: { dynamic: true, fields: {} } });
            });

            it(
                "returns the list of existing indexes and detects if they are queryable",
                { timeout: SEARCH_TIMEOUT },
                async ({ signal }) => {
                    await waitUntilSearchIndexIsQueryable(provider, "any", "foo", "default", signal);

                    const response = await integration.mcpClient().callTool({
                        name: "list-search-indexes",
                        arguments: { database: "any", collection: "foo" },
                    });

                    const content = getResponseContent(response.content);
                    const indexDefinition = getSingleDocFromUntrustedContent<SearchIndexStatus>(content);

                    expect(indexDefinition?.name).toEqual("default");
                    expect(indexDefinition?.type).toEqual("search");
                    expect(indexDefinition?.latestDefinition).toEqual({ mappings: { dynamic: true, fields: {} } });
                    expect(indexDefinition?.queryable).toEqual(true);
                    expect(indexDefinition?.status).toEqual("READY");
                }
            );
        });
    },
    undefined, // default user config
    undefined, // default driver config
    { search: true } // use a search cluster
);
