import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@mongodb-js/atlas-local";
import { LogId } from "../../common/logger.js";
import type { AtlasLocalToolMetadata } from "../../telemetry/types.js";

export const AtlasLocalToolMetadataDeploymentIdKey = "deploymentId";

export abstract class AtlasLocalToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";

    protected verifyAllowed(): boolean {
        return this.session.atlasLocalClient !== undefined && super.verifyAllowed();
    }

    protected async execute(...args: Parameters<ToolCallback<typeof this.argsShape>>): Promise<CallToolResult> {
        const client = this.session.atlasLocalClient;

        // If the client is not found, throw an error
        // This should never happen:
        // - atlas-local tools are only added after the client is set
        //   this means that if we were unable to get the client, the tool will not be registered
        // - in case the tool was registered by accident
        //   verifyAllowed would still return false preventing the tool from being registered,
        //   preventing the tool from being executed
        if (!client) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Something went wrong on our end, this tool should have been disabled but it was not.
please log a ticket here: https://github.com/mongodb-js/mongodb-mcp-server/issues/new?template=bug_report.yml`,
                    },
                ],
                isError: true,
            };
        }

        return this.executeWithAtlasLocalClient(client, ...args);
    }

    private async lookupDeploymentId(client: Client, containerId: string): Promise<string | undefined> {
        try {
            // Lookup and return the deployment id for telemetry metadata.
            return await client.getDeploymentId(containerId);
        } catch (error) {
            this.session.logger.debug({
                id: LogId.telemetryMetadataError,
                context: "tool",
                message: `Error looking up deployment ID: ${String(error)}`,
            });

            return undefined;
        }
    }

    protected async lookupTelemetryMetadata(client: Client, containerId: string): Promise<{ [key: string]: unknown }> {
        if (!this.telemetry.isTelemetryEnabled()) {
            return {};
        }

        const deploymentId = await this.lookupDeploymentId(client, containerId);
        if (deploymentId === undefined) {
            return {};
        }

        return {
            [AtlasLocalToolMetadataDeploymentIdKey]: deploymentId,
        };
    }

    protected abstract executeWithAtlasLocalClient(
        client: Client,
        ...args: Parameters<ToolCallback<typeof this.argsShape>>
    ): Promise<CallToolResult>;

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        // Error Handling for expected Atlas Local errors go here
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check if Docker daemon is not running
        if (
            errorMessage.includes("Cannot connect to the Docker daemon") ||
            errorMessage.includes("Is the docker daemon running") ||
            errorMessage.includes("connect ENOENT") ||
            errorMessage.includes("ECONNREFUSED")
        ) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Docker is not running. Please start Docker and try again. Atlas Local tools require Docker to be running.",
                    },
                ],
                isError: true,
            };
        }

        if (errorMessage.includes("No such container")) {
            const deploymentName =
                "deploymentName" in args ? (args.deploymentName as string) : "the specified deployment";
            return {
                content: [
                    {
                        type: "text",
                        text: `The Atlas Local deployment "${deploymentName}" was not found. Please check the deployment name or use "atlas-local-list-deployments" to see available deployments.`,
                    },
                ],
                isError: true,
            };
        }

        // For other types of errors, use the default error handling from the base class
        return super.handleError(error, args);
    }

    protected resolveTelemetryMetadata(result: CallToolResult): AtlasLocalToolMetadata {
        const toolMetadata: AtlasLocalToolMetadata = {};

        // Atlas Local tools set the deployment ID in the result metadata for telemetry
        // If the deployment ID is set, we use it for telemetry
        const resultDeploymentId = result._meta?.[AtlasLocalToolMetadataDeploymentIdKey];
        if (resultDeploymentId !== undefined && typeof resultDeploymentId === "string") {
            toolMetadata.atlas_local_deployment_id = resultDeploymentId;
        }

        return toolMetadata;
    }
}
