import { z } from "zod";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { OperationType, ToolResult } from "../../tool.js";
import { ConnectionSummarySchema, summarizeConnection } from "../../../common/connectionSummary.js";
import { connectCapableTools } from "../../../common/connectionErrorHandler.js";

export class ListConnectionsTool extends MongoDBToolBase {
    static toolName = "list-connections";
    public override description = this.config.connectionString
        ? 'List the active MongoDB connections and their connectionIds. Use this to discover the "preconfigured" connection or to find a connectionId established earlier.'
        : "List the active MongoDB connections and their connectionIds. Use this to find a connectionId established earlier.";

    public override argsShape = {};

    static operationType: OperationType = "metadata";

    public override outputSchema = {
        connections: z.array(ConnectionSummarySchema),
    };

    protected override async execute(): Promise<ToolResult<typeof this.outputSchema>> {
        const entries = await this.session.connectionRegistry.find();
        const connections = entries.map((entry) => summarizeConnection(entry));

        const text =
            connections.length === 0
                ? this.noConnectionsText()
                : `Active connections:\n${connections
                      .map(
                          (connection) =>
                              `- "${connection.connectionId}" (${connection.state ?? "unknown"}): ${connection.description}`
                      )
                      .join("\n")}`;

        return {
            content: [{ type: "text", text }],
            structuredContent: { connections },
        };
    }

    private noConnectionsText(): string {
        const connectToolNames = connectCapableTools(this.server?.tools ?? [])
            .map((tool) => `"${tool.name}"`)
            .join(", ");
        return connectToolNames
            ? `There are no active connections. Use one of the following tools to establish one: ${connectToolNames}.`
            : "There are no active connections and no tools to establish one are enabled. Update the MCP server configuration to include a connection string.";
    }
}
