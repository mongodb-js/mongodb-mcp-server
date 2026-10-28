import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { PrometheusMetricsOptions } from "./types.js";

export class PrometheusMetrics<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TInjectedLabelNames extends string = never,
> implements IMetrics<TMetricsDefinitions, TInjectedLabelNames> {
    public readonly registry: Registry;
    /** The metric instances keyed by logical name, shared by every labeled sibling. */
    public readonly definitions: TMetricsDefinitions;
    /** Labels added to every metric recorded through this instance. */
    public readonly labels: Readonly<Partial<Record<TInjectedLabelNames, string>>>;

    constructor({
        definitions,
        registry,
        collectProcessMetrics = false,
        labels,
    }: PrometheusMetricsOptions<TMetricsDefinitions, TInjectedLabelNames>) {
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

    /**
     * A sibling sharing this instance's `definitions` and `registry`, with
     * `labels` merged on top of this instance's own, so a per-request or
     * per-session label value lands in the same series space rather than a
     * second registry. Additive only: labels already set cannot be removed.
     */
    withLabels(
        labels: Readonly<Partial<Record<TInjectedLabelNames, string>>>
    ): PrometheusMetrics<TMetricsDefinitions, TInjectedLabelNames> {
        return new PrometheusMetrics({
            definitions: this.definitions,
            registry: this.registry,
            labels: { ...this.labels, ...labels },
        });
    }

    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
