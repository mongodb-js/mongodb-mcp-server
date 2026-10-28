import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import { RESERVED_METRIC_LABEL_NAMES, type IMetrics, type DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
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
    /** Label names the definitions set per observation; rejected as injected labels. */
    private readonly reservedLabelNames: readonly string[];

    constructor({
        definitions,
        registry,
        collectProcessMetrics = false,
        labels,
        reservedLabelNames = RESERVED_METRIC_LABEL_NAMES,
    }: PrometheusMetricsOptions<TMetricsDefinitions, TInjectedLabelNames>) {
        // Copied so a caller mutating its object later cannot change this instance's series.
        const frozenLabels = Object.freeze({ ...labels });
        // Checked before any registry mutation, so a rejected instance leaves none behind.
        for (const name of Object.keys(frozenLabels)) {
            if (reservedLabelNames.includes(name)) {
                throw new Error(
                    `Injected metric label "${name}" is reserved by the metric definitions for per-observation use`
                );
            }
        }

        this.registry = registry ?? new Registry();
        if (collectProcessMetrics) {
            collectDefaultMetrics({ register: this.registry });
        }
        this.definitions = definitions;
        this.labels = frozenLabels;
        this.reservedLabelNames = reservedLabelNames;

        for (const key in this.definitions) {
            const metric = this.definitions[key];
            this.registry.registerMetric(metric as Metric);
        }
    }

    /**
     * A sibling sharing this instance's `definitions` and `registry`, with
     * `labels` merged on top of this instance's own: labels can be added or
     * overridden, but not removed, so a per-request or per-session value lands
     * in the same series space rather than a second registry.
     */
    withLabels(
        labels: Readonly<Partial<Record<TInjectedLabelNames, string>>>
    ): PrometheusMetrics<TMetricsDefinitions, TInjectedLabelNames> {
        return new PrometheusMetrics({
            definitions: this.definitions,
            registry: this.registry,
            labels: { ...this.labels, ...labels },
            reservedLabelNames: this.reservedLabelNames,
        });
    }

    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
