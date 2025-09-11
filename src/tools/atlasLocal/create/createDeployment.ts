import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client } from "@mongodb-js-preview/atlas-local";
import type { CreateDeploymentOptions, CreationSourceType } from "@mongodb-js-preview/atlas-local";
import z from "zod";

export class CreateDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-create-deployment";
    protected description = "Create a MongoDB Atlas local deployment";
    public operationType: OperationType = "create";
    protected argsShape = {
        deploymentName: z.string().describe("Name of the deployment to create"),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        const deploymentOptions: CreateDeploymentOptions = {
            name: deploymentName,
            creationSource: "MCPServer",
        };
        // Create the deployment
        await client.createDeployment(deploymentOptions);

        return {
            content: [{ type: "text", text: `Deployment ${deploymentName} created.` }],
        };
    }
}
