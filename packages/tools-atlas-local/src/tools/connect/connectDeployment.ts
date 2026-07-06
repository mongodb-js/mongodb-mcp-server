import type { CallToolResult } from "@mongodb-js/mcp-types";
import { AtlasLocalToolBase } from "../../atlasLocalTool.js";
import type { ToolArgs } from "@mongodb-js/mcp-core";
import type { OperationType } from "@mongodb-js/mcp-types";
import type { Client } from "@mongodb-js/atlas-local";
import { CommonArgs } from "@mongodb-js/mcp-core";
import type { ConnectionMetadata } from "@mongodb-js/mcp-types";
import { waitForConnectionString } from "../../connectionString.js";

export class ConnectDeploymentTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-connect-deployment";
    public description = "Connect to a MongoDB Atlas Local deployment";
    static operationType: OperationType = "connect";
    public argsShape = {
        deploymentName: CommonArgs.asciiOnlyString().describe("Name of the deployment to connect to"),
    };

    protected async executeWithAtlasLocalClient(
        { deploymentName }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<CallToolResult> {
        // Get the connection string for the deployment. atlas-local-create-deployment can return
        // before Docker publishes port bindings, so retry briefly to usually avoid surfacing that
        // race condition to the caller.
        const connectionString = await waitForConnectionString(client, deploymentName);

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

    protected override resolveTelemetryMetadata(
        args: ToolArgs<typeof this.argsShape>,
        { result }: { result: CallToolResult }
    ): ConnectionMetadata {
        return { ...super.resolveTelemetryMetadata(args, { result }), ...this.getConnectionInfoMetadata() };
    }
}
