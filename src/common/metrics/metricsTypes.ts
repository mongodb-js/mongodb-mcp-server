import type { Counter, Histogram, Gauge } from "prom-client";

export type MetricInstances = {
    [key: string]: Histogram | Counter | Gauge;
};

export type EmptyMetricInstances = MetricInstances & {};

export type Metrics<TMetrics extends MetricInstances = MetricInstances> = {
    /**
     * Get a metric instance by key
     */
    get<K extends keyof TMetrics>(key: K): TMetrics[K];

    /**
     * Get metrics in a format suitable for export (e.g., Prometheus text format)
     */
    getMetrics(): Promise<string>;
};
