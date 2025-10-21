import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";

export class DeleteDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-delete-deployment";
    protected description = "Delete a MongoDB Atlas local deployment";
    public operationType: OperationType = "delete";
    protected argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to delete"),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        // Lookup telemetry metadata
        // We need to lookup the telemetry metadata before deleting the deployment
        // to ensure that the deployment ID is set in the result metadata
        const telemetryMetadata = await this.lookupTelemetryMetadata(client, deploymentName);

        // Delete the deployment
        await client.deleteDeployment(deploymentName);

        return {
            content: [{ type: "text", text: `Deployment "${deploymentName}" deleted successfully.` }],
            _meta: {
                ...telemetryMetadata,
            },
        };
    }
}
