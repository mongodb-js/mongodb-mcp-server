import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata, ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@mongodb-js-preview/atlas-local";
import { LogId } from "../../common/logger.js";
import { z } from "zod";

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

    protected async lookupDeploymentId(client: Client, containerId: string): Promise<string> {
        // Lookup and return the deployment id for telemetry metadata.
        const deploymentId = await client.getDeploymentId(containerId);
        return deploymentId;
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

    protected async resolveTelemetryMetadata(
        ...args: Parameters<ToolCallback<typeof this.argsShape>>
    ): Promise<TelemetryToolMetadata> {
        const toolMetadata: TelemetryToolMetadata = {};

        const client = this.session.atlasLocalClient;
        if (!args.length || !client) {
            return toolMetadata;
        }

        // Create a typed parser for the exact shape we expect
        const argsShape = z.object(this.argsShape);
        const parsedResult = argsShape.safeParse(args[0]);

        if (!parsedResult.success) {
            this.session.logger.debug({
                id: LogId.telemetryMetadataError,
                context: "tool",
                message: `Error parsing tool arguments: ${parsedResult.error.message}`,
            });
            return toolMetadata;
        }

        const data = parsedResult.data;

        // Extract deploymentName using type guard and lookup deployment ID
        if ("deploymentName" in data && typeof data.deploymentName === "string" && data.deploymentName.trim() !== "") {
            const deploymentId = await this.lookupDeploymentId(client, data.deploymentName);
            toolMetadata.atlasLocaldeploymentId = deploymentId;
        }

        return toolMetadata;
    }
}
