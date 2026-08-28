import { z } from "zod";
import { MongoDBToolBase } from "../../mongodbTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import { PRECONFIGURED_CONNECTION_ID } from "../../common/connectionRegistry.js";

const DisconnectOutputSchema = {
    outcome: z.enum(["removed", "disconnected"]),
};

export class DisconnectTool extends MongoDBToolBase {
    static toolName = "disconnect";
    public override description = this.server.config.connectionString
        ? 'Close a MongoDB connection and revoke its connectionId. Disconnecting the "preconfigured" connection only closes it — it reconnects automatically on next use because the server configuration still declares it.'
        : "Close a MongoDB connection and revoke its connectionId.";

    public override argsShape = {
        connectionId: z.string().describe("The connectionId to disconnect."),
    };

    static operationType: OperationType = "connect";

    public override outputSchema = DisconnectOutputSchema;

    protected override async execute({
        connectionId,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        await this.server.connectionRegistry.disconnect(connectionId);

        if (connectionId === PRECONFIGURED_CONNECTION_ID) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Closed the "${PRECONFIGURED_CONNECTION_ID}" connection. It remains available and will reconnect automatically on next use.`,
                    },
                ],
                structuredContent: { outcome: "disconnected" },
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Disconnected. The connectionId "${connectionId}" is no longer valid; use the connect tools to establish a new connection if needed.`,
                },
            ],
            structuredContent: { outcome: "removed" },
        };
    }
}
