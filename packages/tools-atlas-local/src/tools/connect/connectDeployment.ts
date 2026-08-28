import type { CallToolResult, ConnectionMetadata, OperationType, ToolExecutionContext } from "@mongodb-js/mcp-types";
import { AtlasLocalToolBase } from "../../atlasLocalTool.js";
import type { ToolArgs, ToolResult } from "@mongodb-js/mcp-core";
import { CommonArgs } from "@mongodb-js/mcp-core";
import type { Client } from "@mongodb-js/atlas-local";
import { AtlasLocalDeploymentNotReadyError, waitForConnectionString } from "../../connectionString.js";
import { z } from "zod";

const ConnectDeploymentOutputSchema = {
    connected: z.boolean(),
    deploymentName: z.string(),
    connectionId: z.string().optional(),
};

export class ConnectDeploymentTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-connect-deployment";
    public description =
        "Connect to a MongoDB Atlas Local deployment and get back a connectionId to pass to the other MongoDB tools";
    static operationType: OperationType = "connect";
    public argsShape = {
        deploymentName: CommonArgs.asciiOnlyString().describe("Name of the deployment to connect to"),
    };

    public override outputSchema = ConnectDeploymentOutputSchema;

    protected async executeWithAtlasLocalClient(
        { deploymentName }: ToolArgs<typeof this.argsShape>,
        { client, context }: { client: Client; context: ToolExecutionContext }
    ): Promise<ToolResult<typeof ConnectDeploymentOutputSchema> & Pick<CallToolResult, "_meta">> {
        let connectionString: string;
        try {
            // Get the connection string for the deployment. atlas-local-create-deployment can return
            // before Docker publishes port bindings, so retry briefly to usually avoid surfacing that
            // race condition to the caller.
            connectionString = await waitForConnectionString(client, deploymentName);
        } catch (error: unknown) {
            if (error instanceof AtlasLocalDeploymentNotReadyError) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Atlas Local deployment "${deploymentName}" is still starting up. Wait a few seconds and call atlas-local-connect-deployment again with the same deployment name.`,
                        },
                    ],
                    structuredContent: {
                        connected: false,
                        deploymentName,
                    },
                    isError: true,
                };
            }
            throw error;
        }

        // Establish the connection through the connection registry so it can be
        // referenced by its connectionId from the other MongoDB tools.
        const entry = await this.server.connectionRegistry.connect({
            settings: { connectionString },
            name: deploymentName,
            clientName: context.request.clientInfo?.name,
        });

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully connected to Atlas Local deployment "${deploymentName}". Your connectionId is "${entry.connectionId}" — pass it as the connectionId argument to all MongoDB tool calls that should run against this deployment.`,
                },
            ],
            structuredContent: {
                connected: true,
                deploymentName,
                connectionId: entry.connectionId,
            },
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deploymentName)),
            },
        };
    }

    protected override async resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): Promise<ConnectionMetadata> {
        const connectionId = (result.structuredContent as { connectionId?: string } | undefined)?.connectionId;
        return {
            ...(await super.resolveTelemetryMetadata(args, { result })),
            ...(connectionId && { connection_id: connectionId }),
            ...this.getConnectionInfoMetadata(
                connectionId ? (await this.server.connectionRegistry.peek(connectionId))?.state : undefined
            ),
        };
    }
}
