import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata, ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@mongodb-js-preview/atlas-local";

export abstract class AtlasLocalToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";

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

    protected abstract executeWithAtlasLocalClient(
        client: Client,
        ...args: Parameters<ToolCallback<typeof this.argsShape>>
    ): Promise<CallToolResult>;

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        // Error Handling for expected Atlas Local errors go here

        // For other types of errors, use the default error handling from the base class
        return super.handleError(error, args);
    }

    protected resolveTelemetryMetadata(
        ...args: Parameters<ToolCallback<typeof this.argsShape>>
    ): TelemetryToolMetadata {
        // TODO: include deployment id in the metadata where possible
        void args; // this shuts up the eslint rule until we implement the TODO above
        return {};
    }
}
