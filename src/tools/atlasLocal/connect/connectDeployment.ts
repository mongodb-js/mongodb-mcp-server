import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs, ToolResult } from "../../tool.js";
import type { Client } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";
import type { ConnectionMetadata } from "../../../telemetry/types.js";

const ConnectDeploymentOutputSchema = {
    connected: z.boolean(),
    deploymentName: z.string(),
};

export class ConnectDeploymentTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-connect-deployment";
    public description = "Connect to a MongoDB Atlas Local deployment";
    static operationType: OperationType = "connect";
    public argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to connect to"),
    };

    public override outputSchema = ConnectDeploymentOutputSchema;

    protected async executeWithAtlasLocalClient(
        { deploymentName }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<ToolResult<typeof ConnectDeploymentOutputSchema> & Pick<CallToolResult, "_meta">> {
        // Get the connection string for the deployment
        const connectionString = await client.getConnectionString(deploymentName);

        await this.session.connectToMongoDB({ connectionString });

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully connected to Atlas Local deployment "${deploymentName}".`,
                },
            ],
            structuredContent: {
                connected: true,
                deploymentName,
            },
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deploymentName)),
            },
        };
    }

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): ConnectionMetadata {
        return { ...super.resolveTelemetryMetadata(args, { result }), ...this.getConnectionInfoMetadata() };
    }
}
