import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AtlasLocalToolBase } from "../atlasLocalTool.js";
import type { OperationType, ToolArgs, ToolResult } from "../../tool.js";
import type { Client, CreateDeploymentOptions, Deployment } from "@mongodb-js/atlas-local";
import {
    AtlasLocalDeploymentNotReadyError,
    waitForConnectionString,
} from "../../../common/atlasLocal/connectionString.js";
import { CommonArgs } from "../../args.js";

const CreateDeploymentOutputSchema = {
    deploymentName: z.string(),
    containerId: z.string(),
    loadSampleData: z.boolean(),
    imageTag: z.string(),
};

export type CreateDeploymentOutput = z.infer<z.ZodObject<typeof CreateDeploymentOutputSchema>>;

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

    public override outputSchema = CreateDeploymentOutputSchema;

    protected async executeWithAtlasLocalClient(
        { deploymentName, loadSampleData, imageTag }: ToolArgs<typeof this.argsShape>,
        { client }: { client: Client }
    ): Promise<ToolResult<typeof CreateDeploymentOutputSchema> & Pick<CallToolResult, "_meta">> {
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
        const deployment = await client.createDeployment(deploymentOptions);

        // createDeployment returns once the container is healthy, but Docker may
        // not have published port bindings yet. Block until connect can succeed.
        const resolvedDeploymentName = deployment.name ?? deploymentName;
        let stillStarting = false;
        if (resolvedDeploymentName) {
            try {
                await waitForConnectionString(client, resolvedDeploymentName);
            } catch (error: unknown) {
                if (error instanceof AtlasLocalDeploymentNotReadyError) {
                    stillStarting = true;
                } else {
                    throw error;
                }
            }
        }

        const structuredContent = this.buildStructuredContent(deployment, {
            deploymentName: resolvedDeploymentName ?? "",
            loadSampleData,
            imageTag,
        });

        const startingNote = stillStarting
            ? " The deployment is still initializing; if atlas-local-connect-deployment fails, wait a few seconds and try connecting again."
            : "";

        return {
            content: [
                {
                    type: "text",
                    text: `Deployment with container ID "${deployment.containerId}" and name "${deployment.name}" created (imageTag: ${imageTag}).${startingNote}`,
                },
            ],
            structuredContent,
            _meta: {
                ...(await this.lookupTelemetryMetadata(client, deployment.containerId)),
            },
        };
    }

    private buildStructuredContent(
        deployment: Deployment,
        args: { deploymentName: string; loadSampleData: boolean; imageTag: string }
    ): CreateDeploymentOutput {
        return {
            deploymentName: args.deploymentName,
            containerId: deployment.containerId,
            loadSampleData: args.loadSampleData,
            imageTag: args.imageTag,
        };
    }
}
