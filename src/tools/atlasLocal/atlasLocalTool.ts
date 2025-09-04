import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TelemetryToolMetadata, ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type AtlasLocal from "@mongodb-js-preview/atlas-local";

export abstract class AtlasLocalToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";
    // Will be injected by BuildAtlasLocalTools() in atlasLocal/tools.ts
    public client?: AtlasLocal.Client;

    protected verifyAllowed(): boolean {
        return this.client !== undefined && super.verifyAllowed();
    }

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
