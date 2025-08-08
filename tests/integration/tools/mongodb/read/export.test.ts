import path from "path";
import { Long } from "bson";
import fs from "fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
    databaseCollectionParameters,
    defaultTestConfig,
    resourceChangedNotification,
    validateThrowsForInvalidArguments,
    validateToolMetadata,
} from "../../../helpers.js";
import { describeWithMongoDB } from "../mongodbHelpers.js";
import { UserConfig } from "../../../../../src/lib.js";

const userConfig: UserConfig = {
    ...defaultTestConfig,
    exportsPath: path.join(path.dirname(defaultTestConfig.exportsPath), `exports-${Date.now()}`),
};

export function contentWithTextResourceURI(
    content: CallToolResult["content"]
): CallToolResult["content"][number] | undefined {
    return content.find((part) => {
        return part.type === "text" && part.text.startsWith(`Data for namespace`);
    });
}

export function contentWithResourceURILink(
    content: CallToolResult["content"]
): CallToolResult["content"][number] | undefined {
    return content.find((part) => {
        return part.type === "resource_link";
    });
}

export function contentWithExportPath(
    content: CallToolResult["content"]
): CallToolResult["content"][number] | undefined {
    return content.find((part) => {
        return (
            part.type === "text" &&
            part.text.startsWith(
                `Optionally, when the export is finished, the exported data can also be accessed under path -`
            )
        );
    });
}

describeWithMongoDB(
    "export tool",
    (integration) => {
        validateToolMetadata(
            integration,
            "export",
            "Export a collection data or query results in the specified EJSON format.",
            [
                ...databaseCollectionParameters,
                {
                    name: "exportTitle",
                    description: "A short description to uniquely identify the export.",
                    type: "string",
                    required: true,
                },
                {
                    name: "filter",
                    description: "The query filter, matching the syntax of the query argument of db.collection.find()",
                    type: "object",
                    required: false,
                },
                {
                    name: "jsonExportFormat",
                    description: [
                        "The format to be used when exporting collection data as EJSON with default being relaxed.",
                        "relaxed: A string format that emphasizes readability and interoperability at the expense of type preservation. That is, conversion from relaxed format to BSON can lose type information.",
                        "canonical: A string format that emphasizes type preservation at the expense of readability and interoperability. That is, conversion from canonical to BSON will generally preserve type information except in certain specific cases.",
                    ].join("\n"),
                    type: "string",
                    required: false,
                },
                {
                    name: "limit",
                    description: "The maximum number of documents to return",
                    type: "number",
                    required: false,
                },
                {
                    name: "projection",
                    description:
                        "The projection, matching the syntax of the projection argument of db.collection.find()",
                    type: "object",
                    required: false,
                },
                {
                    name: "sort",
                    description:
                        "A document, describing the sort order, matching the syntax of the sort argument of cursor.sort(). The keys of the object are the fields to sort on, while the values are the sort directions (1 for ascending, -1 for descending).",
                    type: "object",
                    required: false,
                },
            ]
        );

        validateThrowsForInvalidArguments(integration, "export", [
            {},
            { database: 123, collection: "bar" },
            { database: "test", collection: [] },
            { database: "test", collection: "bar", filter: "{ $gt: { foo: 5 } }" },
            { database: "test", collection: "bar", projection: "name" },
            { database: "test", collection: "bar", limit: "10" },
            { database: "test", collection: "bar", sort: [], limit: 10 },
        ]);

        beforeEach(async () => {
            await integration.connectMcpClient();
        });

        afterAll(async () => {
            await fs.rm(userConfig.exportsPath, { recursive: true, force: true });
        });

        it("when provided with incorrect namespace, export should have empty data", async function () {
            const response = await integration.mcpClient().callTool({
                name: "export",
                arguments: {
                    database: "non-existent",
                    collection: "foos",
                    exportTitle: "Export for non-existent.foos",
                },
            });
            const content = response.content as CallToolResult["content"];
            const exportURI = contentWithResourceURILink(content)?.uri as string;
            await resourceChangedNotification(integration.mcpClient(), exportURI);

            expect(content).toHaveLength(3);
            expect(contentWithTextResourceURI(content)).toBeDefined();
            expect(contentWithResourceURILink(content)).toBeDefined();

            const localPathPart = contentWithExportPath(content);
            expect(localPathPart).toBeDefined();

            const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
            expect(localPath).toBeDefined();

            expect(await fs.readFile(localPath as string, "utf8")).toEqual("[]");
        });

        describe("with correct namespace", function () {
            beforeEach(async () => {
                const mongoClient = integration.mongoClient();
                await mongoClient
                    .db(integration.randomDbName())
                    .collection("foo")
                    .insertMany([
                        { name: "foo", longNumber: new Long(1234) },
                        { name: "bar", bigInt: new Long(123412341234) },
                    ]);
            });

            it("should export entire namespace when filter are empty", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toHaveLength(2);
                expect(exportedContent[0]?.name).toEqual("foo");
                expect(exportedContent[1]?.name).toEqual("bar");
            });

            it("should export filter results namespace when there are filters", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        filter: { name: "foo" },
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toHaveLength(1);
                expect(exportedContent[0]?.name).toEqual("foo");
            });

            it("should export results limited to the provided limit", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        limit: 1,
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toHaveLength(1);
                expect(exportedContent[0]?.name).toEqual("foo");
            });

            it("should export results with sorted by the provided sort", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        limit: 1,
                        sort: { longNumber: 1 },
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toHaveLength(1);
                expect(exportedContent[0]?.name).toEqual("bar");
            });

            it("should export results containing only projected fields", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        limit: 1,
                        projection: { _id: 0, name: 1 },
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toEqual([
                    {
                        name: "foo",
                    },
                ]);
            });

            it("should export relaxed json when provided jsonExportFormat is relaxed", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        limit: 1,
                        projection: { _id: 0 },
                        jsonExportFormat: "relaxed",
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toEqual([
                    {
                        name: "foo",
                        longNumber: 1234,
                    },
                ]);
            });

            it("should export canonical json when provided jsonExportFormat is canonical", async function () {
                await integration.connectMcpClient();
                const response = await integration.mcpClient().callTool({
                    name: "export",
                    arguments: {
                        database: integration.randomDbName(),
                        collection: "foo",
                        limit: 1,
                        projection: { _id: 0 },
                        jsonExportFormat: "canonical",
                        exportTitle: `Export for ${integration.randomDbName()}.foo`,
                    },
                });
                const content = response.content as CallToolResult["content"];
                const exportURI = contentWithResourceURILink(content)?.uri as string;
                await resourceChangedNotification(integration.mcpClient(), exportURI);

                const localPathPart = contentWithExportPath(content);
                expect(localPathPart).toBeDefined();
                const [, localPath] = /"(.*)"/.exec(String(localPathPart?.text)) ?? [];
                expect(localPath).toBeDefined();

                const exportedContent = JSON.parse(await fs.readFile(localPath as string, "utf8")) as Record<
                    string,
                    unknown
                >[];
                expect(exportedContent).toEqual([
                    {
                        name: "foo",
                        longNumber: {
                            $numberLong: "1234",
                        },
                    },
                ]);
            });
        });
    },
    () => userConfig
);
