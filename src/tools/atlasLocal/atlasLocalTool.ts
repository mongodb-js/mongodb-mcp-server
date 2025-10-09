import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata, ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@mongodb-js-preview/atlas-local";

export abstract class AtlasLocalToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";
    protected deploymentId?: string;

    protected verifyAllowed(): boolean {
        return this.session.atlasLocalClient !== undefined && super.verifyAllowed();
    }

    protected async execute(...args: Parameters<ToolCallback<typeof this.argsShape>>): Promise<CallToolResult> {
        // Get the client
        const client = this.session.atlasLocalClient;

        // If the client is not found, throw an error
        // This should never happen:
        // - atlas-local tools are only added after the client is set
        //   this means that if we were unable to get the client, the tool will not be registered
        // - in case the tool was registered by accident
        //   verifyAllowed in the base class would still return false preventing the tool from being registered,
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

    protected async lookupDeploymentIdAndAddToTelemetryMetadata(client: Client, containerId: string): Promise<void> {
        // Don't run if telemetry is disabled
        if (this.config.telemetry === "disabled") {
            return;
        }

        // Lookup the deployment id and add it to the telemetry metadata
        const deploymentId = await client.getDeploymentId(containerId);
        this.deploymentId = deploymentId;
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

    protected resolveTelemetryMetadata(): TelemetryToolMetadata {
        return {
            atlasLocaldeploymentId: this.deploymentId,
        };
    }
}
