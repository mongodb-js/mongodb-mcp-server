import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationType, ToolArgs } from "../../tool.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { FindArgs } from "./find.js";
import { jsonExportFormat } from "../../../common/sessionExportsManager.js";
import z from "zod";

export class ExportTool extends MongoDBToolBase {
    public name = "export";
    protected description = "Export a collection data or query results in the specified json format.";
    protected argsShape = {
        ...DbOperationArgs,
        ...FindArgs,
        limit: z.number().optional().describe("The maximum number of documents to return"),
        jsonExportFormat: jsonExportFormat
            .default("relaxed")
            .describe(
                [
                    "The format to be used when exporting collection data as JSON with default being relaxed.",
                    "relaxed: A string format that emphasizes readability and interoperability at the expense of type preservation. That is, conversion from relaxed format to BSON can lose type information.",
                    "canonical: A string format that emphasizes type preservation at the expense of readability and interoperability. That is, conversion from canonical to BSON will generally preserve type information except in certain specific cases.",
                ].join("\n")
            ),
    };
    public operationType: OperationType = "read";

    protected async execute({
        database,
        collection,
        jsonExportFormat,
        filter,
        projection,
        sort,
        limit,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const findCursor = provider.find(database, collection, filter ?? {}, {
            projection,
            sort,
            limit,
            promoteValues: false,
            bsonRegExp: true,
        });
        const exportName = `${database}.${collection}.${Date.now()}.json`;
        if (!this.exportsManager) {
            throw new Error("Incorrect server configuration, export not possible!");
        }

        await this.exportsManager.createJSONExport({ input: findCursor, exportName, jsonExportFormat });
        const exportedResourceURI = this.exportsManager.exportNameToResourceURI(exportName);
        const exportedResourcePath = this.exportsManager.exportFilePath(
            this.exportsManager.exportsDirectoryPath(),
            exportName
        );
        const toolCallContent: CallToolResult["content"] = [
            // Not all the clients as of this commit understands how to
            // parse a resource_link so we provide a text result for them to
            // understand what to do with the result.
            {
                type: "text",
                text: `Exported data for namespace ${database}.${collection} is available under resource URI - "${exportedResourceURI}".`,
            },
            {
                type: "resource_link",
                name: exportName,
                uri: exportedResourceURI,
                description: "Resource URI for fetching exported data.",
                mimeType: "application/json",
            },
        ];

        // This special case is to make it easier to work with exported data for
        // stdio transport.
        if (this.config.transport === "stdio") {
            toolCallContent.push({
                type: "text",
                text: `Optionally, the exported data can also be accessed under path - "${exportedResourcePath}"`,
            });
        }

        return {
            content: toolCallContent,
        };
    }
}
