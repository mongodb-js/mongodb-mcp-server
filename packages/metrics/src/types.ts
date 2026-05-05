import type { Counter, Histogram, Gauge, Registry } from "prom-client";
import type { IMetrics, MetricDefinitions } from "@mongodb-js/mcp-types";

export type PrometheusMetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
} & MetricDefinitions;

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<TMetricsDefinitions extends PrometheusMetricDefinitions> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetricsDefinitions;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}

export interface Metrics<
    TMetricsDefinitions extends PrometheusMetricDefinitions = PrometheusMetricDefinitions,
> extends IMetrics<TMetricsDefinitions> {
    /**
     * Get a metric instance by key.
     */
    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K];

    /**
     * Get metrics in a format suitable for export (e.g., Prometheus text format).
     */
    getMetrics(): Promise<string>;
}
