import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { Metrics, PrometheusMetricDefinitions, PrometheusMetricsOptions } from "./types.js";

export class PrometheusMetrics<
    TMetricsDefinitions extends PrometheusMetricDefinitions,
> implements Metrics<TMetricsDefinitions> {
    public readonly registry: Registry;
    private readonly definitions: TMetricsDefinitions;

    constructor({
        definitions,
        registry,
        collectProcessMetrics = false,
    }: PrometheusMetricsOptions<TMetricsDefinitions>) {
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

    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
