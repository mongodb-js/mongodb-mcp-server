import type { Counter, Histogram, Gauge, Registry } from "prom-client";
import type { DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

export type PrometheusMetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
} & DefaultMetricDefinitions;

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TInjectedLabelNames extends string = never,
> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetricsDefinitions;
    /**
     * Label names the metric definitions set per observation. An injected label
     * using one of these names is rejected, because the observation-level value
     * always wins and the injected one would be silently ignored. Defaults to
     * the names the default definitions use.
     */
    reservedLabelNames?: readonly string[];
    /**
     * Labels added to every metric recorded through this instance. A sibling
     * instance sharing the same `definitions` and `registry` can carry a
     * different set. The names are injected by the consumer, not this package.
     */
    labels?: Readonly<Partial<Record<TInjectedLabelNames, string>>>;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}
