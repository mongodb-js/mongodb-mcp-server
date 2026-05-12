import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MetricDefinitions, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { LogLevel } from "@mongodb-js/mcp-core";
import type { CompositeLogger } from "./logging/compositeLogger.js";

// Re-export MetricDefinitions types from @mongodb-js/mcp-types for convenience
export type { MetricDefinitions, DefaultMetricDefinitions };

/**
 * Options for creating an MCP server instance.
 * Passed to the `createServer()` method in transport runners.
 */
export type ServerOptions<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> = {
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

/**
 * Base configuration options for all transport runners.
 */
export type TransportRunnerBaseOptions<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> = {
    /** Logger instance */
    logger: CompositeLogger;

    /** Metrics instance */
    metrics: IMetrics<TMetrics>;
};
