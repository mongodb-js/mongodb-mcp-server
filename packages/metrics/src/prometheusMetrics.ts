import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { RESERVED_METRIC_LABEL_NAMES } from "./reservedLabels.js";
import type { InstanceLabels, PrometheusMetricsOptions } from "./types.js";

const RESERVED_LABELS: ReadonlySet<string> = new Set(RESERVED_METRIC_LABEL_NAMES);

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
        // Copied so a caller mutating its object later cannot change this instance's series.
        const frozenLabels = Object.freeze({ ...labels });
        // Checked before any registry mutation, so a rejected instance leaves none behind.
        for (const [name, value] of Object.entries(frozenLabels)) {
            if (value === undefined) {
                throw new Error(`Instance metric label "${name}" must have a value`);
            }
            if (RESERVED_LABELS.has(name)) {
                throw new Error(
                    `Instance metric label "${name}" is reserved by the metric definitions for per-observation use`
                );
            }
        }

        this.registry = registry ?? new Registry();
        if (collectProcessMetrics) {
            collectDefaultMetrics({ register: this.registry });
        }
        this.definitions = definitions;
        this.labels = frozenLabels;

        for (const key in this.definitions) {
            const metric = this.definitions[key];
            this.registry.registerMetric(metric as Metric);
        }
    }

    /**
     * A sibling sharing this instance's `definitions` and `registry`. `labels`
     * merge onto this instance's own: added or overridden, never removed.
     */
    withLabels(labels: InstanceLabels<TMetricsDefinitions>): PrometheusMetrics<TMetricsDefinitions> {
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
