import type { Counter, Histogram, Gauge } from "prom-client";

export type MetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
};

export type EmptyMetricDefinitions = MetricDefinitions & {};

export type Metrics<TMetrics extends MetricDefinitions = MetricDefinitions> = {
    /**
     * Get a metric instance by key
     */
    get<K extends keyof TMetrics>(key: K): TMetrics[K];

    /**
     * Get metrics in a format suitable for export (e.g., Prometheus text format)
     */
    getMetrics(): Promise<string>;
};
