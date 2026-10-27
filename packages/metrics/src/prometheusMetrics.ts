import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { PrometheusMetricsOptions } from "./types.js";

export class PrometheusMetrics<
    TMetricsDefinitions extends DefaultMetricDefinitions,
> implements IMetrics<TMetricsDefinitions> {
    public readonly registry: Registry;
    /** The metric instances keyed by logical name, shared by every labeled sibling. */
    public readonly definitions: TMetricsDefinitions;
    /** Labels added to every metric recorded through this instance. */
    public readonly labels: Readonly<Record<string, string>>;

    constructor({
        definitions,
        registry,
        collectProcessMetrics = false,
        labels,
    }: PrometheusMetricsOptions<TMetricsDefinitions>) {
        this.registry = registry ?? new Registry();
        if (collectProcessMetrics) {
            collectDefaultMetrics({ register: this.registry });
        }
        this.definitions = definitions;
        // Copied so a caller mutating its object later cannot change this instance's series.
        this.labels = Object.freeze({ ...labels });

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
