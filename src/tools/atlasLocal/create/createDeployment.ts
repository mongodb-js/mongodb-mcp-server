import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs } from "../../tool.js";
import type { Client, CreateDeploymentOptions } from "@mongodb-js/atlas-local";
import { CommonArgs } from "../../args.js";
import z from "zod";

export class CreateDeploymentTool extends AtlasLocalToolBase {
    static toolName = "atlas-local-create-deployment";
    public description =
        "Create a MongoDB Atlas local deployment. Default image is preview. When the user does not specify an image tag, inform them that preview is used by default and provide this link for more information: https://hub.docker.com/r/mongodb/mongodb-atlas-local";
    static operationType: OperationType = "create";
    public argsShape = {
        deploymentName: CommonArgs.string().describe("Name of the deployment to create").optional(),
        loadSampleData: z.boolean().describe("Load sample data into the deployment").optional().default(false),
        imageTag: z
            .string()
            .describe("Atlas Local image tag: 'preview', 'latest', or a semver (e.g. '8.0.0'). Default: 'preview'.")
            .optional()
            .default("preview"),
    };

    protected async executeWithAtlasLocalClient(
        { deploymentName, loadSampleData, imageTag }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<CallToolResult> {
        const deploymentOptions: CreateDeploymentOptions = {
            name: deploymentName,
            creationSource: {
                type: "MCPServer",
                source: "MCPServer",
            },
            loadSampleData,
            imageTag,
            ...(this.config.voyageApiKey ? { voyageApiKey: this.config.voyageApiKey } : {}),
            doNotTrack: !this.telemetry.isTelemetryEnabled(),
        };
        // Create the deployment
        const deployment = await client.createDeployment(deploymentOptions);

        return {
            content: [
                {
                    type: "text",
                    text: `Deployment with container ID "${deployment.containerId}" and name "${deployment.name}" created (imageTag: ${imageTag}).`,
                },
            ],
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deployment.containerId)),
            },
        };
    }
}
