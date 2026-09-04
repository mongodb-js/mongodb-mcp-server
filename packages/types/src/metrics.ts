/**
 * Labels type for metrics.
 */
export type MetricLabels = Partial<Record<string, string | number>>;

/**
 * Interface for observable metrics (like histograms).
 * Used for recording values that can be observed over time.
 */
export interface IObservable {
    observe(labels: MetricLabels, value: number): void;
}

/**
 * Interface for counter metrics.
 * Used for counting events, can be incremented.
 */
export interface ICounter {
    inc(labels?: MetricLabels, value?: number): void;
}

/**
 * Interface for gauge metrics.
 * Used for metrics that can go up and down (e.g. currently active sessions).
 */
export interface IGauge {
    set(value: number): void;
    inc(labels?: MetricLabels, value?: number): void;
    dec(labels?: MetricLabels, value?: number): void;
}

/**
 * Default metric definitions for MCP servers.
 * These are the standard metrics used across the MCP packages.
 */
export type DefaultMetricDefinitions = {
    /** Histogram for tracking tool execution duration in seconds */
    toolExecutionDuration: IObservable;
};

/**
 * Interface for accessing metrics.
 * @template TMetricsDefinitions - The type of metric definitions this metrics instance uses
 */
export interface IMetrics<TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions> {
    /** Get a specific metric by name */
    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K];
    /** Get all metrics as a formatted string (e.g., Prometheus format) */
    getMetrics(): Promise<string>;
}
