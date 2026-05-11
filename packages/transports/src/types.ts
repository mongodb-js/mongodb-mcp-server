import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ICompositeLogger, IKeychain } from "@mongodb-js/mcp-types";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { LogLevel, LoggerBase } from "@mongodb-js/mcp-core";
import type { InMemoryTransport } from "./inMemoryTransport.js";

// Re-export MetricDefinitions types from @mongodb-js/mcp-types for convenience
export type { MetricDefinitions, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

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
 * Options for creating a session.
 * Decoupled from UserConfig to allow flexible configuration.
 */
export type SessionOptions = {
    /** Logger for the session */
    logger: ICompositeLogger;
    /** Session ID */
    sessionId?: string;
    /** API client for external services */
    apiClient?: unknown;
    /** Atlas local client */
    atlasLocalClient?: unknown;
    /** Connection manager for MongoDB */
    connectionManager?: unknown;
    /** Error handler for connection errors */
    connectionErrorHandler?: unknown;
    /** Keychain for secrets */
    keychain?: IKeychain;
};

/**
 * Base configuration options for all transport runners.
 */
export type TransportRunnerBaseOptions<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /** Optional metrics instance */
    metrics?: IMetrics<TMetrics>;

    /** Optional loggers to use */
    loggers?: LoggerBase[];
};

/**
 * Server factory function type for creating server instances.
 */
export type ServerFactory<TServer> = (options: {
    serverOptions?: CustomizableServerOptions;
    sessionOptions?: CustomizableSessionOptions;
}) => Promise<TServer>;

/**
 * StdioServer type for StdioRunner.
 */
export type StdioServer = {
    connect(transport: StdioServerTransport): Promise<void>;
    close(): Promise<void>;
};

/**
 * Configuration for the StdioRunner.
 */
export type StdioRunnerOptions<TMetrics extends MetricDefinitions = MetricDefinitions> =
    TransportRunnerBaseOptions<TMetrics> & {
        /** Factory function for creating server instances */
        createServer?: ServerFactory<StdioServer>;
    };

/**
 * DryRunServer type for DryRunModeRunner.
 */
export type DryRunServer = {
    tools: { name: string; category: string; isEnabled(): boolean }[];
    connect(transport: InMemoryTransport): Promise<void>;
    close(): Promise<void>;
};

/**
 * Configuration for the DryRunModeRunner.
 */
export type DryRunModeRunnerOptions<TMetrics extends MetricDefinitions = MetricDefinitions> =
    TransportRunnerBaseOptions<TMetrics> & {
        /** Console logger for outputting config and tools */
        consoleLogger: {
            log(message: string): void;
            error(message: string): void;
        };
        /** Factory function for creating server instances */
        createServer?: ServerFactory<DryRunServer>;
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
