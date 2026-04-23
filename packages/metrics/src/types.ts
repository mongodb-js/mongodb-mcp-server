import type { Counter, Histogram, Gauge, Registry } from "prom-client";

export type MetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
};

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<TMetrics extends MetricDefinitions> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetrics;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}

export interface Metrics<TMetrics extends MetricDefinitions = MetricDefinitions> {
    /**
     * Get a metric instance by key.
     */
    get<K extends keyof TMetrics>(key: K): TMetrics[K];

    /**
     * Get metrics in a format suitable for export (e.g., Prometheus text format).
     */
    getMetrics(): Promise<string>;
}
