import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MetricDefinitions } from "@mongodb-js/mcp-types";
import type {
    TransportRunnerBaseOptions,
    CustomizableServerOptions,
    CustomizableSessionOptions,
    InMemoryTransport,
} from "@mongodb-js/mcp-core";

// Re-export base types from core for convenience
export type {
    TransportRunnerBaseOptions,
    CustomizableServerOptions,
    CustomizableSessionOptions,
    MetricDefinitions,
    DefaultMetricDefinitions,
} from "@mongodb-js/mcp-core";

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
