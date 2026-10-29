import { Registry, type Metric, collectDefaultMetrics } from "prom-client";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { RESERVED_METRIC_LABEL_NAMES } from "./reservedLabels.js";
import type { InstanceLabels, PrometheusMetricsOptions } from "./types.js";

const RESERVED_LABELS: ReadonlySet<string> = new Set(RESERVED_METRIC_LABEL_NAMES);
const NO_LABELS = Object.freeze({});

export class PrometheusMetrics<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TKeys extends keyof TMetricsDefinitions = keyof TMetricsDefinitions,
> implements IMetrics<TMetricsDefinitions> {
    public readonly registry: Registry;
    /** The metric instances keyed by logical name, shared by every labeled sibling. */
    public readonly definitions: TMetricsDefinitions;
    private labelsValue: InstanceLabels<TMetricsDefinitions, TKeys> = NO_LABELS;

    constructor({
        definitions,
        registry,
        collectProcessMetrics = false,
    }: PrometheusMetricsOptions<TMetricsDefinitions, TKeys>) {
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

    /** Labels added to every metric recorded through this instance. */
    public get labels(): InstanceLabels<TMetricsDefinitions, TKeys> {
        return this.labelsValue;
    }

    /**
     * The only way to label an instance: a sibling sharing this instance's
     * `definitions` and `registry`. `scope` names the metrics the labels will be
     * emitted through — a label is accepted only if every one of them declares
     * it, and without a scope the intersection is every definition, which allows
     * none. `labels` merge onto this instance's own: added or overridden, never
     * removed.
     */
    withLabels<TScopedKeys extends TKeys = TKeys>(
        labels: InstanceLabels<TMetricsDefinitions, TScopedKeys>,
        { scope }: { scope?: readonly TScopedKeys[] } = {}
    ): PrometheusMetrics<TMetricsDefinitions, TScopedKeys> {
        for (const key of scope ?? []) {
            if (!(key in this.definitions)) {
                throw new Error(`Unknown metric key "${String(key)}"`);
            }
        }

        // Copied so a caller mutating its object later cannot change this instance's series.
        const merged = Object.freeze({ ...this.labels, ...labels });
        for (const [name, value] of Object.entries(merged)) {
            if (value === undefined) {
                throw new Error(`Instance metric label "${name}" must have a value`);
            }
            if (RESERVED_LABELS.has(name)) {
                throw new Error(
                    `Instance metric label "${name}" is reserved by the metric definitions for per-observation use`
                );
            }
        }

        const sibling = new PrometheusMetrics<TMetricsDefinitions, TScopedKeys>({
            definitions: this.definitions,
            registry: this.registry,
        });
        sibling.labelsValue = merged as InstanceLabels<TMetricsDefinitions, TScopedKeys>;
        return sibling;
    }

    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K] {
        return this.definitions[key];
    }

    async getMetrics(): Promise<string> {
        return this.registry.metrics();
    }
}
