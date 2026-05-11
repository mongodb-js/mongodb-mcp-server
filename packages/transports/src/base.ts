import { CompositeLogger, type LoggerBase } from "@mongodb-js/mcp-core";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type { CustomizableServerOptions, CustomizableSessionOptions, MetricDefinitions } from "./types.js";

/**
 * Base class for all transport runners.
 * Provides common functionality. Subclasses should override `createServer()`
 * to customize server instantiation.
 */
export abstract class TransportRunnerBase<
    TServer = unknown,
    TContext = unknown,
    TMetrics extends MetricDefinitions = MetricDefinitions,
> {
    public logger: CompositeLogger;
    public metrics: IMetrics<TMetrics>;

    protected constructor({ loggers, metrics }: { loggers?: LoggerBase[]; metrics?: IMetrics<TMetrics> }) {
        this.metrics = metrics ?? this.createNoopMetrics();

        // Initialize logger
        const baseLoggers = loggers ?? [];
        this.logger = new CompositeLogger({ loggers: baseLoggers });
    }

    /**
     * Creates a no-op metrics implementation for when no metrics are provided.
     * Returns an empty string for getMetrics() and undefined for any metric get.
     */
    private createNoopMetrics(): IMetrics<TMetrics> {
        return {
            get: <K extends keyof TMetrics>() => undefined as TMetrics[K],
            getMetrics: () => Promise.resolve(""),
        } as IMetrics<TMetrics>;
    }

    /**
     * Creates a new MCP server instance with the provided configuration.
     * Subclasses should override this method to customize server creation.
     */
    protected abstract createServer(options: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }): Promise<TServer>;

    /**
     * Starts the transport runner.
     */
    abstract start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions<TContext>;
        sessionOptions?: CustomizableSessionOptions;
    }): Promise<void>;

    /**
     * Stops the transport runner and releases any resources.
     * This is called by `close()` and should be implemented by subclasses
     * to handle transport-specific cleanup.
     */
    abstract stop(): Promise<void>;

    /**
     * Closes the transport runner and cleans up resources.
     * This calls `stop()` internally and also flushes the logger.
     */
    async close(): Promise<void> {
        try {
            await this.stop();
        } finally {
            await this.logger.flush();
        }
    }
}
