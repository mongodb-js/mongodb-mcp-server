import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ICompositeLogger, MetricDefinitions, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { LogLevel, LoggerBase } from "@mongodb-js/mcp-core";

// Re-export MetricDefinitions types from @mongodb-js/mcp-types for convenience
export type { MetricDefinitions, DefaultMetricDefinitions };

/**
 * Options for creating an MCP server instance.
 * Passed to the `createServer()` method in transport runners.
 */
export type ServerOptions<TContext = unknown, TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /** MCP Server instance */
    mcpServer: McpServer;
    /** Logger for the server */
    logger: ICompositeLogger;
    /** Metrics instance for tracking server metrics */
    metrics?: IMetrics<TMetrics>;
    /** Custom tool context */
    toolContext?: TContext;
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
export type TransportRunnerBaseOptions<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /** Metrics instance */
    metrics: IMetrics<TMetrics>;

    /** Optional loggers to use */
    loggers?: LoggerBase[];
};

/**
 * Options that can be customized when starting a runner.
 * Passed to the `start()` method and forwarded to `createServer()`.
 */
export type CustomizableServerOptions<TContext = unknown> = {
    /** Custom tool context */
    toolContext?: TContext;
    /** Telemetry properties */
    telemetryProperties?: Record<string, string>;
};

/**
 * Options that can be customized for sessions when starting a runner.
 */
export type CustomizableSessionOptions = {
    /** API client instance */
    apiClient?: unknown;
    /** Atlas local client instance */
    atlasLocalClient?: unknown;
    /** Connection manager instance */
    connectionManager?: unknown;
    /** Connection error handler */
    connectionErrorHandler?: unknown;
};
