import type { CompositeLogger } from "./logging/compositeLogger.js";
import type { IMetrics } from "@mongodb-js/mcp-types";
import type {
    CustomizableServerOptions,
    CustomizableSessionOptions,
    MetricDefinitions,
    DefaultMetricDefinitions,
} from "./transports.js";

/**
 * Base class for all transport runners.
 * Provides common lifecycle management (start/stop/close) and logging.
 */
export abstract class TransportRunnerBase<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> {
    public logger: CompositeLogger;
    public metrics: IMetrics<TMetrics>;

    protected constructor({ logger, metrics }: { logger: CompositeLogger; metrics: IMetrics<TMetrics> }) {
        this.metrics = metrics;
        this.logger = logger;
    }

    /**
     * Starts the transport runner.
     */
    abstract start({
        serverOptions,
        sessionOptions,
    }: {
        serverOptions?: CustomizableServerOptions;
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
