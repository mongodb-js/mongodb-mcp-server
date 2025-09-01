import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolArgs, ToolCategory } from "../tool.js";
import { ToolBase } from "../tool.js";

export abstract class AtlasLocalToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";

    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {
        // Error Handling for expected Atlas Local errors go here

        // For other types of errors, use the default error handling from the base class
        return super.handleError(error, args);
    }
}
