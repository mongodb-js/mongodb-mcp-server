import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client, CreateDeploymentOptions } from "@mongodb-js/atlas-local";
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
                type: "MCPServer",
                source: "MCPServer",
            },
            doNotTrack: !this.telemetry.isTelemetryEnabled(),
        };
        // Create the deployment
        const deployment = await client.createDeployment(deploymentOptions);

        return {
            content: [
                {
                    type: "text",
                    text: `Deployment with container ID "${deployment.containerId}" and name "${deployment.name}" created.`,
                },
            ],
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deployment.containerId)),
            },
        };
    }
}
