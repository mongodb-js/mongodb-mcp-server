import { z } from "zod";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { OperationType, ToolResult } from "../../tool.js";
import { summarizeConnection } from "../../../common/connectionSummary.js";
import { connectCapableTools } from "../../../common/connectionErrorHandler.js";

const ConnectionSummarySchema = z.object({
    connectionId: z.string(),
    name: z.string(),
    source: z.enum(["explicit", "preconfigured"]),
    state: z.enum(["connected", "connecting", "disconnected", "errored"]).optional(),
    description: z.string(),
    lastError: z.string().optional(),
    createdAt: z.string(),
    lastUsedAt: z.string(),
});

const ListConnectionsOutputSchema = {
    connections: z.array(ConnectionSummarySchema),
};

export class ListConnectionsTool extends MongoDBToolBase {
    static toolName = "list-connections";
    public override description =
        'List the active MongoDB connections and their connectionIds. Use this to discover the "preconfigured" connection (present when the server was started with a configured connection string) or to find a connectionId established earlier.';

    public override argsShape = {};

    static operationType: OperationType = "metadata";

    public override outputSchema = ListConnectionsOutputSchema;

    protected override async execute(): Promise<ToolResult<typeof this.outputSchema>> {
        const entries = await this.session.connectionRegistry.find(() => true);
        const connections = entries.map((entry) => {
            const summary = summarizeConnection(entry);
            return {
                ...summary,
                createdAt: summary.createdAt.toISOString(),
                lastUsedAt: summary.lastUsedAt.toISOString(),
            };
        });

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
