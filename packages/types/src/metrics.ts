/**
 * Labels type for metrics.
 */
type MetricLabels = Partial<Record<string, string | number>>;

/**
 * Label names `ToolBase` sets on `toolExecutionDuration`. Server metric labels
 * with these names are ignored.
 */
export const TOOL_EXECUTION_DURATION_LABEL_NAMES = [
    "tool_name",
    "category",
    "status",
    "operation_type",
    "error_type",
] as const;

/** A label name `ToolBase` sets on `toolExecutionDuration`. */
export type ToolExecutionDurationLabelName = (typeof TOOL_EXECUTION_DURATION_LABEL_NAMES)[number];

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
    /** Counter for tracking created sessions */
    sessionCreated: ICounter;
    /** Counter for tracking closed sessions with reason label */
    sessionClosed: ICounter;
    /** Histogram for tracking tool execution duration in seconds */
    toolExecutionDuration: IObservable;
    /** Gauge for tracking currently active sessions */
    sessionsActive: IGauge;
};

/**
 * Interface for accessing metrics.
 * @template TMetricsDefinitions - The type of metric definitions this metrics instance uses
 * @template TInstanceLabelNames - Label names the consumer adds to these metrics; this
 * package names none of them. Defaults to `never` (no instance labels).
 */
export interface IMetrics<
    TMetricsDefinitions extends DefaultMetricDefinitions = DefaultMetricDefinitions,
    TInstanceLabelNames extends string = never,
> {
    /**
     * Labels applied to every metric this object records, merged under the
     * labels of a specific observation. The definitions must declare them.
     */
    readonly labels: Readonly<Partial<Record<TInstanceLabelNames, string>>>;
    /** Get a specific metric by name */
    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K];
    /** Get all metrics as a formatted string (e.g., Prometheus format) */
    getMetrics(): Promise<string>;
}
