import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs, TelemetryToolMetadata } from "../../tool.js";
import type { Client, CreateDeploymentOptions } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";

export class CreateDeploymentTool extends AtlasLocalToolBase {
    public name = "atlas-local-create-deployment";
    protected description = "Create a MongoDB Atlas local deployment";
    public operationType: OperationType = "create";
    protected argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to create").optional(),
    };

    private createdDeploymentId?: string;

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

        // Capture deployment ID for telemetry
        this.createdDeploymentId = await this.lookupDeploymentId(client, deployment.containerId);

        return {
            content: [
                {
                    type: "text",
                    text: `Deployment with container ID "${deployment.containerId}" and name "${deployment.name}" created.`,
                },
            ],
        };
    }

    // Create tool needs to override resolveTelemetryMetadata because it doesn't
    // have the deployment name in the arguments, but rather in the response.
    protected resolveTelemetryMetadata(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ...args: Parameters<ToolCallback<typeof this.argsShape>>
    ): Promise<TelemetryToolMetadata> {
        return Promise.resolve({
            atlasLocaldeploymentId: this.createdDeploymentId,
        });
    }
}
