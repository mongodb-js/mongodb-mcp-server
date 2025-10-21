import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";

export class ConnectDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-connect-deployment";
    protected description = "Connect to a MongoDB Atlas Local deployment";
    public operationType: OperationType = "connect";
    protected argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to connect to"),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        // Get the connection string for the deployment
        const connectionString = await client.getConnectionString(deploymentName);

        // Connect to the deployment
        await this.session.connectToMongoDB({ connectionString });

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully connected to Atlas Local deployment "${deploymentName}".`,
                },
            ],
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deploymentName)),
            },
        };
    }
}
