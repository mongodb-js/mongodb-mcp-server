import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs, ToolResult } from "../../tool.js";
import type { Client } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";

const DeleteDeploymentOutputSchema = {
    deleted: z.boolean(),
    deploymentName: z.string(),
};

export class DeleteDeploymentTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-delete-deployment";
    public description = "Delete a MongoDB Atlas local deployment";
    static operationType: OperationType = "delete";
    public argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to delete"),
    };

    public override outputSchema = DeleteDeploymentOutputSchema;

    protected async executeWithAtlasLocalClient(
        { deploymentName }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<ToolResult<typeof DeleteDeploymentOutputSchema> & Pick<CallToolResult, "_meta">> {
        // Resolve deployment ID for telemetry before the deployment is removed.
        const telemetryMetadata = await this.lookupTelemetryMetadata(client, deploymentName);

        await client.deleteDeployment(deploymentName);

        return {
            content: [{ type: "text", text: `Deployment "${deploymentName}" deleted successfully.` }],
            structuredContent: {
                deleted: true,
                deploymentName,
            },
            _meta: {
                ...telemetryMetadata,
            },
        };
    }
}
