import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { Metrics, MetricDefinitions, PrometheusMetricsOptions } from "./types.js";

export class PrometheusMetrics<TMetrics extends MetricDefinitions> implements Metrics<TMetrics> {
    public readonly registry: Registry;
    private readonly definitions: TMetrics;

    constructor({ definitions, registry, collectProcessMetrics = false }: PrometheusMetricsOptions<TMetrics>) {
        this.registry = registry ?? new Registry();
        if (collectProcessMetrics) {
            collectDefaultMetrics({ register: this.registry });
        }
        this.definitions = definitions;

        for (const key in this.definitions) {
            const metric = this.definitions[key];
            this.registry.registerMetric(metric as Metric);
        }
    }

    get<K extends keyof TMetrics>(key: K): TMetrics[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
