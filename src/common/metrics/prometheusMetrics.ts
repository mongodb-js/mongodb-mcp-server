import { Counter, Histogram, Gauge, Registry, type Metric } from "prom-client";
import type { Metrics, MetricInstances } from "./metricsTypes.js";

export class PrometheusMetrics<TMetrics extends MetricInstances> implements Metrics<TMetrics> {
    public readonly registry: Registry;
    private readonly definitions: TMetrics;

    constructor({ definitions, registry }: { definitions: TMetrics; registry?: Registry }) {
        this.registry = registry ?? new Registry();
        this.definitions = definitions;

        for (const key in this.definitions) {
            const metric = this.definitions[key];
            if (metric instanceof Histogram || metric instanceof Counter || metric instanceof Gauge) {
                this.registry.registerMetric(metric as Metric);
            }
        }
    }

    get<K extends keyof TMetrics>(key: K): TMetrics[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
