import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ToolArgs, ToolBase, ToolCategory } from "../tool.js";

export abstract class AtlasToolBase extends ToolBase {
    public category: ToolCategory = "atlas-local";


    protected handleError(
        error: unknown,
        args: ToolArgs<typeof this.argsShape>
    ): Promise<CallToolResult> | CallToolResult {

    // Error Handling for expected atlas-local errors go here

        // For other types of errors, use the default error handling from the base class
        return super.handleError(error, args);
    }
}