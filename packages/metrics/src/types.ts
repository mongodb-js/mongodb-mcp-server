import type { Counter, Histogram, Gauge, Registry } from "prom-client";
import type { DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

export type PrometheusMetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
} & DefaultMetricDefinitions;

/**
 * Labels a caller may pass. With no label names declared the set is empty, so
 * passing any label is a type error: `{}` would skip excess-property checking
 * and accept typos.
 */
export type InstanceLabels<TInstanceLabelNames extends string> = [TInstanceLabelNames] extends [never]
    ? Record<string, never>
    : Readonly<Partial<Record<TInstanceLabelNames, string>>>;

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TInstanceLabelNames extends string = never,
> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetricsDefinitions;
    /**
     * Labels added to every metric recorded through this instance. A sibling
     * sharing the same `definitions` and `registry` can carry a different set.
     */
    labels?: InstanceLabels<TInstanceLabelNames>;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}
