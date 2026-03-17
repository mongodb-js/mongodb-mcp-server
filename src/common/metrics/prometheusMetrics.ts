import { Registry, type Metric } from "prom-client";
import type { Metrics, MetricDefinitions } from "./metricsTypes.js";

export class PrometheusMetrics<TMetrics extends MetricDefinitions> implements Metrics<TMetrics> {
    public readonly registry: Registry;
    private readonly definitions: TMetrics;

    constructor({ definitions, registry }: { definitions: TMetrics; registry?: Registry }) {
        this.registry = registry ?? new Registry();
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
