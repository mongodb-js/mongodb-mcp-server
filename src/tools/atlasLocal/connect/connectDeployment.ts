import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client } from "@mongodb-js-preview/atlas-local";
import { z } from "zod";

export class ConnectDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-connect-deployment";
    protected description = "Connect to a MongoDB Atlas Local deployment";
    public operationType: OperationType = "connect";
    protected argsShape = {
        deploymentName: z.string().describe("Name of the deployment to connect to"),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        // Get the connection string for the deployment
        const connectionString = await client.getConnectionString(deploymentName);

        // Connect to the deployment
        await this.session.connectToMongoDB({ connectionString });

        // Lookup the deployment id and add it to the telemetry metadata
        await this.lookupDeploymentId(client, deploymentName);

        return {
            content: [
                {
                    type: "text",
                    text: `Successfully connected to Atlas Local deployment "${deploymentName}".`,
                },
            ],
        };
    }
}
