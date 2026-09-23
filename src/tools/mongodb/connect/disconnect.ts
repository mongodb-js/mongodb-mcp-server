import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult } from "../../tool.js";
import type { ConnectionMetadata } from "../../../telemetry/types.js";
import { PRECONFIGURED_CONNECTION_ID } from "../../../common/connectionRegistry.js";

const DisconnectOutputSchema = {
    outcome: z.enum(["removed", "disconnected"]),
};

export class DisconnectTool extends MongoDBToolBase {
    static toolName = "disconnect";
    public override description = this.config.connectionString
        ? 'Close a MongoDB connection and revoke its connectionId. Disconnecting the "preconfigured" connection only closes it — it reconnects automatically on next use because the server configuration still declares it.'
        : "Close a MongoDB connection and revoke its connectionId.";

    public override argsShape = {
        connectionId: z.string().describe("The connectionId to disconnect."),
    };

    static operationType: OperationType = "connect";

    public override outputSchema = DisconnectOutputSchema;

    /**
     * The connection metadata captured before the entry is revoked.
     * `disconnect` removes explicit entries from the registry, so the
     * post-execute telemetry lookup alone can no longer attribute the cluster;
     * snapshot it here instead.
     */
    private disconnectedMetadata?: ConnectionMetadata;

    protected override async execute({
        connectionId,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        // Capture Atlas attribution before revocation: `disconnect` deletes the
        // explicit entry, and its state loses `connectionStringInfo` on close.
        const entry = await this.peekConnection(connectionId);
        this.disconnectedMetadata = entry ? this.getConnectionInfoMetadata(entry) : undefined;
        await this.session.connectionRegistry.disconnect(connectionId);

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

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        { result }: { result: CallToolResult }
    ): Promise<ConnectionMetadata> {
        const { connectionId } = args as { connectionId?: string };
        // Prefer the snapshot taken before revocation; fall back to a live peek
        // (e.g. the preconfigured entry is closed, not removed, so still peekable).
        const metadata =
            this.disconnectedMetadata ?? this.getConnectionInfoMetadata(await this.peekConnection(connectionId));
        this.disconnectedMetadata = undefined;
        return {
            ...(connectionId && { connection_id: connectionId }),
            ...(metadata ?? {}),
        };
    }
}
