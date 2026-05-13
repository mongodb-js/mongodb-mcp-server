import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DefaultMetricDefinitions, IMetrics, LogLevel } from "@mongodb-js/mcp-types";
import type { CompositeLogger } from "./logging/compositeLogger.js";

/**
 * Options for creating an MCP server instance.
 * Passed to the `createServer()` method in transport runners.
 */
export type ServerOptions<TMetrics extends DefaultMetricDefinitions = DefaultMetricDefinitions> = {
    /** MCP Server instance */
    mcpServer: McpServer;
    /** Logger for the server */
    logger: CompositeLogger;
    /** Metrics instance for tracking server metrics */
    metrics?: IMetrics<TMetrics>;
    /** Log level for MCP client */
    mcpLogLevel?: LogLevel;
    /** Server name */
    name?: string;
    /** Server version */
    version?: string;
};
