import { Long } from "bson";
import { describe, expect, it, beforeEach } from "vitest";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defaultTestConfig, timeout } from "../helpers.js";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";

describeWithMongoDB(
    "exported-data resource",
    (integration) => {
        beforeEach(async () => {
            const mongoClient = integration.mongoClient();
            await mongoClient
                .db("db")
                .collection("coll")
                .insertMany([
                    { name: "foo", longNumber: new Long(1234) },
                    { name: "bar", bigInt: new Long(123412341234) },
                ]);
        });

        it("should be able to list resource template", async () => {
            await integration.connectMcpClient();
            const response = await integration.mcpClient().listResourceTemplates();
            expect(response.resourceTemplates).toEqual([
                {
                    name: "exported-data",
                    uriTemplate: "exported-data://{exportName}",
                    description: "Data files exported in the current session.",
                },
            ]);
        });

        describe("when requesting non-existent resource", () => {
            it("should return an error", async () => {
                const exportURI = "exported-data://db.coll.json";
                await integration.connectMcpClient();
                const response = await integration.mcpClient().readResource({
                    uri: exportURI,
                });
                expect(response.isError).toEqual(true);
                expect(response.contents[0]?.uri).toEqual(exportURI);
                expect(response.contents[0]?.text).toEqual(
                    `Error reading ${exportURI}: Requested export has either expired or does not exist!`
                );
            });
        });

        describe("when requesting an expired resource", () => {
            it("should return an error", async () => {
                await integration.connectMcpClient();
                const exportResponse = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: { database: "db", collection: "coll" },
                });

                const exportedResourceURI = (exportResponse as CallToolResult).content.find(
                    (part) => part.type === "resource_link"
                )?.uri;
                expect(exportedResourceURI).toBeDefined();

                // wait for export expired
                await timeout(250);
                const response = await integration.mcpClient().readResource({
                    uri: exportedResourceURI as string,
                });
                expect(response.isError).toEqual(true);
                expect(response.contents[0]?.uri).toEqual(exportedResourceURI);
                expect(response.contents[0]?.text).toMatch(`Error reading ${exportedResourceURI}:`);
            });
        });

        describe("after requesting a fresh export", () => {
            it("should be able to read the resource", async () => {
                await integration.connectMcpClient();
                const exportResponse = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: { database: "db", collection: "coll" },
                });
                // Small timeout to let export finish
                await timeout(50);

                const exportedResourceURI = (exportResponse as CallToolResult).content.find(
                    (part) => part.type === "resource_link"
                )?.uri;
                expect(exportedResourceURI).toBeDefined();

                const response = await integration.mcpClient().readResource({
                    uri: exportedResourceURI as string,
                });
                expect(response.isError).toBeFalsy();
                expect(response.contents[0]?.mimeType).toEqual("application/json");
                expect(response.contents[0]?.text).toContain("foo");
            });

            it("should be able to autocomplete the resource", async () => {
                await integration.connectMcpClient();
                const exportResponse = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: { database: "big", collection: "coll" },
                });
                // Small timeout to let export finish
                await timeout(50);

                const exportedResourceURI = (exportResponse as CallToolResult).content.find(
                    (part) => part.type === "resource_link"
                )?.uri;
                expect(exportedResourceURI).toBeDefined();

                const completeResponse = await integration.mcpClient().complete({
                    ref: {
                        type: "ref/resource",
                        uri: "exported-data://{exportName}",
                    },
                    argument: {
                        name: "exportName",
                        value: "b",
                    },
                });
                expect(completeResponse.completion.total).toEqual(1);
            });
        });
    },
    () => {
        return {
            ...defaultTestConfig,
            exportTimeoutMs: 200,
            exportCleanupIntervalMs: 300,
        };
    }
);
