import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client } from "@mongodb-js-preview/atlas-local";

export class DeleteDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-delete-deployment";
    protected description = "Delete a MongoDB Atlas local deployment";
    public operationType: OperationType = "delete";
    protected argsShape = {
        deploymentName: z.string().describe("Name of the deployment to delete"),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        // Lookup the deployment id and add it to the telemetry metadata
        await this.lookupDeploymentIdAndAddToTelemetryMetadata(client, deploymentName);

        // Delete the deployment
        await client.deleteDeployment(deploymentName);

        return {
            content: [{ type: "text", text: `Deployment "${deploymentName}" deleted successfully.` }],
        };
    }
}
