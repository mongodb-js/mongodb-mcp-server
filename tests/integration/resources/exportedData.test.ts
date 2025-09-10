import path from "path";
import fs from "fs/promises";
import { Long } from "bson";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { defaultTestConfig, resourceChangedNotification, timeout } from "../helpers.js";
import { describeWithMongoDB } from "../tools/mongodb/mongodbHelpers.js";
import { contentWithResourceURILink } from "../tools/mongodb/read/export.test.js";
import type { UserConfig } from "../../../src/lib.js";

const userConfig: UserConfig = {
    ...defaultTestConfig,
    exportsPath: path.join(path.dirname(defaultTestConfig.exportsPath), `exports-${Date.now()}`),
    exportTimeoutMs: 200,
    exportCleanupIntervalMs: 300,
};

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

        afterAll(async () => {
            await fs.rm(userConfig.exportsPath, { recursive: true, force: true });
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
                    `Error reading ${exportURI}: Requested export has either expired or does not exist.`
                );
            });
        });

        describe("when requesting an expired resource", () => {
            it("should return an error", async () => {
                await integration.connectMcpClient();
                const exportResponse = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: "db",
                        collection: "coll",
                        exportTitle: "Export for db.coll",
                        exportTarget: [{ name: "find", arguments: {} }],
                    },
                });

                const exportedResourceURI = (exportResponse as CallToolResult).content.find(
                    (part) => part.type === "resource_link"
                )?.uri;
                expect(exportedResourceURI).toBeDefined();

                // wait for export expired
                for (let tries = 0; tries < 10; tries++) {
                    await timeout(300);
                    const response = await integration.mcpClient().readResource({
                        uri: exportedResourceURI as string,
                    });

                    // wait for an error from the MCP Server as it
                    // means the resource is not available anymore
                    if (response.isError !== true) {
                        continue;
                    }

                    expect(response.isError).toEqual(true);
                    expect(response.contents[0]?.uri).toEqual(exportedResourceURI);
                    expect(response.contents[0]?.text).toMatch(`Error reading ${exportedResourceURI}:`);
                    break;
                }
            });
        });

        describe("after requesting a fresh export", () => {
            it("should be able to read the resource", async () => {
                await integration.connectMcpClient();
                const exportResponse = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: "db",
                        collection: "coll",
                        exportTitle: "Export for db.coll",
                        exportTarget: [{ name: "find", arguments: {} }],
                    },
                });
                const content = exportResponse.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

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
                    arguments: {
                        database: "big",
                        collection: "coll",
                        exportTitle: "Export for big.coll",
                        exportTarget: [{ name: "find", arguments: {} }],
                    },
                });
                const content = exportResponse.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

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
                        value: "big",
                    },
                });
                expect(completeResponse.completion.total).toBeGreaterThanOrEqual(1);
            });
        });
    },
    () => userConfig
);
