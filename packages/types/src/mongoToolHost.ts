import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OperationType, ToolCategory } from "./tool.js";

/**
 * Tool surface used when building connection-error guidance (connect tool hints).
 */
export interface IMcpToolForConnectionHandling {
    readonly name: string;
    readonly category: ToolCategory;
    readonly operationType: OperationType;
    isEnabled(): boolean;
}

/**
 * Host object passed to {@link MongoDBToolBase.register} — extends the MCP server
 * with tool registration lists used by MongoDB connection error UX.
 */
export interface IMongoDbToolRegistrationHost {
    mcpServer: McpServer;
    readonly tools: readonly IMcpToolForConnectionHandling[];
    isToolCategoryAvailable(category: ToolCategory): boolean;
}
