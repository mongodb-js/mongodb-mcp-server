import type { Counter, Histogram, Gauge, Registry } from "prom-client";
import type { DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import type { ReservedMetricLabelName } from "./reservedLabels.js";

export type PrometheusMetricDefinitions = {
    [key: string]: Histogram | Counter | Gauge;
} & DefaultMetricDefinitions;

/**
 * Label names a metric declares. prom-client defaults the phantom generic to
 * `string` for a metric declared without `labelNames`, so `string` means none.
 */
type DeclaredLabelNames<TMetric> =
    TMetric extends Counter<infer TLabelNames>
        ? string extends TLabelNames
            ? never
            : TLabelNames
        : TMetric extends Gauge<infer TLabelNames>
          ? string extends TLabelNames
              ? never
              : TLabelNames
          : TMetric extends Histogram<infer TLabelNames>
            ? string extends TLabelNames
                ? never
                : TLabelNames
            : never;

/** Declared label names the definitions do not set per observation. */
type InstanceLabelNames<TMetricsDefinitions extends DefaultMetricDefinitions> = Exclude<
    DeclaredLabelNames<TMetricsDefinitions[keyof TMetricsDefinitions]>,
    ReservedMetricLabelName
>;

/**
 * Labels a caller may pass to a `PrometheusMetrics` built on these definitions:
 * the declared names minus the ones the definitions set per observation. With
 * none left the set is empty, since `{}` skips excess-property checking.
 */
export type InstanceLabels<TMetricsDefinitions extends DefaultMetricDefinitions> = [
    InstanceLabelNames<TMetricsDefinitions>,
] extends [never]
    ? Record<string, never>
    : Readonly<Partial<Record<InstanceLabelNames<TMetricsDefinitions>, string>>>;

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<TMetricsDefinitions extends DefaultMetricDefinitions> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetricsDefinitions;
    /**
     * Labels added to every metric recorded through this instance. A sibling
     * sharing the same `definitions` and `registry` can carry a different set.
     */
    labels?: InstanceLabels<TMetricsDefinitions>;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}
