import { z } from "zod";
import { MongoDBToolBase } from "../mongodbTool.js";
import type { ToolArgs, OperationType, ToolResult, ToolOutput } from "../../tool.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionMetadata } from "../../../telemetry/types.js";
import { PRECONFIGURED_CONNECTION_ID } from "../../../common/connectionRegistry.js";
import { waitForConnectResult } from "../../../common/waitForConnectResult.js";
import { oidcDeviceFlowMessage } from "../../../common/oidcDeviceFlowMessage.js";

const ConnectOutputSchema = {
    connectionId: z.string(),
};

export class ConnectTool extends MongoDBToolBase {
    static toolName = "connect";
    public override description = `Connect to a MongoDB instance and get back a connectionId to pass to the other MongoDB tools. Each call establishes a new, independent connection — multiple connections can be active at the same time.${
        this.config.connectionString
            ? ' A connection with the id "preconfigured" already exists for the connection string the server was configured with — there is no need to call this tool to use it.'
            : ""
    }`;

    public override argsShape = {
        connectionString: z.string().describe("MongoDB connection string (in the mongodb:// or mongodb+srv:// format)"),
        connectionName: z
            .string()
            .refine((value) => value !== PRECONFIGURED_CONNECTION_ID, {
                message: `"${PRECONFIGURED_CONNECTION_ID}" is a reserved connection name`,
            })
            .optional()
            .describe(
                'Optional short label for the connection (stored slugified with a short suffix, e.g. "staging" becomes staging-<suffix>). Shown in connection listings; helpful for telling multiple connections apart.'
            ),
    };

    static operationType: OperationType = "connect";

    public override outputSchema = ConnectOutputSchema;

    protected override async execute({
        connectionString,
        connectionName,
    }: ToolArgs<typeof this.argsShape>): Promise<ToolResult<typeof this.outputSchema>> {
        const entry = await this.session.connectionRegistry.connect({
            settings: { connectionString },
            name: connectionName,
            clientName: this.session.mcpClient?.name,
        });

        // For OIDC, the registry's connect call resolves while still in the `connecting`
        // state — before the device-flow callback has populated the verification
        // URL and user code. Wait for the attempt to make progress so we can
        // surface those to the user directly, instead of reporting success and
        // having the next data operation fail asking them to authenticate.
        if (entry.state.tag === "connecting") {
            const result = await waitForConnectResult({
                events: entry.events,
                getCurrentState: () => entry.state,
            });

            if (result.kind === "device-flow") {
                return {
                    content: [{ type: "text", text: oidcDeviceFlowMessage(result.oidcLoginUrl, result.oidcUserCode) }],
                    structuredContent: { connectionId: entry.connectionId },
                };
            }
        }

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully connected to MongoDB. Your connectionId is "${entry.connectionId}" — pass it as the connectionId argument to all MongoDB tool calls that should run against this connection.`,
                },
            ],
            structuredContent: { connectionId: entry.connectionId },
        };
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): Promise<ConnectionMetadata> {
        const connectionId = (result.structuredContent as ToolOutput<typeof ConnectOutputSchema>).connectionId;
        return {
            ...(connectionId && { connection_id: connectionId }),
            ...this.getConnectionInfoMetadata((await this.peekConnection(connectionId))?.state),
        };
    }
}
