import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client, CreateDeploymentOptions, CreationSourceType } from "@mongodb-js-preview/atlas-local";
import { CommonArgs } from "../../args.js";

export class CreateDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-create-deployment";
    protected description = "Create a MongoDB Atlas local deployment";
    public operationType: OperationType = "create";
    protected argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to create").optional(),
    };

    protected async executeWithAtlasLocalClient(
        client: Client,
        { deploymentName }: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> {
        const deploymentOptions: CreateDeploymentOptions = {
            name: deploymentName,
            creationSource: {
                type: "MCPServer" as CreationSourceType,
                source: "MCPServer",
            },
        };
        // Create the deployment
        const deployment = await client.createDeployment(deploymentOptions);

        // Lookup the deployment id and add it to the telemetry metadata
        await this.lookupDeploymentId(client, deployment.containerId);

        return {
            content: [
                {
                    type: "text",
                    text: `Deployment with container ID "${deployment.containerId}" and name "${deployment.name}" created.`,
                },
            ],
        };
    }
}
