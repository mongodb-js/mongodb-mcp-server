import { z } from "zod";
import { CollOperationArgs, MongoDBToolBase } from "../mongodbTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FindArgs } from "./find.js";
import { AggregateArgs } from "./aggregate.js";

const UI_RESOURCE_URI = `ui://document-browser`;
const UI_RESOURCE_MIME = "text/html;profile=mcp-app";
// Prefix used by @mcp-ui/server to store uiMetadata keys in resource._meta
const MCP_UI_META_PREFIX = "mcpui.dev/ui-";

export class DocumentBrowserTool extends MongoDBToolBase {
    static toolName = "document-browser";
    public description =
        "Open the Document Browser app pre-populated with a query. The app runs the query interactively and lets the user explore results.";
    public argsShape = {
        ...CollOperationArgs,
        query: z.union([
            z.object({ find: z.object(FindArgs) }).describe("A find query"),
            z.object({ aggregate: z.object(AggregateArgs) }).describe("An aggregation pipeline"),
        ]),
    };
    static operationType: OperationType = "read";

    protected override get toolMeta(): Record<string, unknown> {
        return {
            ...super.toolMeta,
            ui: { resourceUri: UI_RESOURCE_URI },
            "ui/resourceUri": UI_RESOURCE_URI,
        };
    }

    protected async execute({ database, collection, query }: ToolArgs<typeof this.argsShape>): Promise<CallToolResult> {
        const html = await this.getAppHtml();
        if (!html) {
            return { content: [{ type: "text", text: "Document Browser app is not available." }] };
        }

        return {
            content: [
                {
                    type: "resource",
                    resource: {
                        uri: UI_RESOURCE_URI,
                        mimeType: UI_RESOURCE_MIME,
                        text: html,
                        _meta: {
                            [`${MCP_UI_META_PREFIX}initial-render-data`]: { database, collection, query },
                        },
                    },
                },
            ],
        };
    }
}
