import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs, ToolResult } from "../../tool.js";
import type { Client } from "@mongodb-js/atlas-local";
import {
    AtlasLocalDeploymentNotReadyError,
    waitForConnectionString,
} from "../../../common/atlasLocal/connectionString.js";
import { CommonArgs } from "../../args.js";
import type { ConnectionMetadata } from "../../../telemetry/types.js";

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
        deploymentName: CommonArgs.string().describe("Name of the deployment to connect to"),
    };

    public override outputSchema = ConnectDeploymentOutputSchema;

    protected async executeWithAtlasLocalClient(
        { deploymentName }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<ToolResult<typeof ConnectDeploymentOutputSchema> & Pick<CallToolResult, "_meta">> {
        let connectionString: string;
        try {
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

        const entry = await this.session.connectionRegistry.connect({
            settings: { connectionString },
            name: deploymentName,
            clientName: this.session.mcpClient?.name,
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
                connectionId ? (await this.session.connectionRegistry.peek(connectionId))?.state : undefined
            ),
        };
    }
}
