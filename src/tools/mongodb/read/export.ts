import z from "zod";
import { ObjectId } from "bson";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OperationType, ToolArgs } from "../../tool.js";
import { DbOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import { FindArgs } from "./find.js";
import { jsonExportFormat } from "../../../common/exportsManager.js";

export class ExportTool extends MongoDBToolBase {
    public name = "export";
    protected description = "Export a collection data or query results in the specified EJSON format.";
    protected argsShape = {
        exportTitle: z.string().describe("A short description to uniquely identify the export."),
        ...DbOperationArgs,
        ...FindArgs,
        limit: z.number().optional().describe("The maximum number of documents to return"),
        jsonExportFormat: jsonExportFormat
            .default("relaxed")
            .describe(
                [
                    "The format to be used when exporting collection data as EJSON with default being relaxed.",
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
        exportTitle,
    }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const provider = await this.ensureConnected();
        const findCursor = provider.find(database, collection, filter ?? {}, {
            projection,
            sort,
            limit,
            promoteValues: false,
            bsonRegExp: true,
        });
        const exportName = `${database}.${collection}.${new ObjectId().toString()}.json`;

        const { exportURI, exportPath } = await this.session.exportsManager.createJSONExport({
            input: findCursor,
            exportName,
            exportTitle:
                exportTitle ||
                `Export for namespace ${database}.${collection} requested on ${new Date().toLocaleString()}`,
            jsonExportFormat,
        });
        const toolCallContent: CallToolResult["content"] = [
            // Not all the clients as of this commit understands how to
            // parse a resource_link so we provide a text result for them to
            // understand what to do with the result.
            {
                type: "text",
                text: `Data for namespace ${database}.${collection} is being exported and will be made available under resource URI - "${exportURI}".`,
            },
            {
                type: "resource_link",
                name: exportName,
                uri: exportURI,
                description: "Resource URI for fetching exported data once it is ready.",
                mimeType: "application/json",
            },
        ];

        // This special case is to make it easier to work with exported data for
        // clients that still cannot reference resources (Cursor).
        // More information here: https://jira.mongodb.org/browse/MCP-104
        if (this.isServerRunningLocally()) {
            toolCallContent.push({
                type: "text",
                text: `Optionally, when the export is finished, the exported data can also be accessed under path - "${exportPath}"`,
            });
        }

        return {
            content: toolCallContent,
        };
    }

    private isServerRunningLocally(): boolean {
        return this.config.transport === "stdio" || ["127.0.0.1", "localhost"].includes(this.config.httpHost);
    }
}
