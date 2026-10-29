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

/**
 * Label names every metric in `TKeys` declares. An instance-wide label set is
 * applied to all of them, so it has to satisfy the intersection — which is why
 * an unscoped instance (`keyof TMetricsDefinitions`) allows none.
 */
type CommonLabelNames<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TKeys extends keyof TMetricsDefinitions,
> = {
    [K in TKeys]: (labels: DeclaredLabelNames<TMetricsDefinitions[K]>) => void;
}[TKeys] extends (labels: infer TCommon extends string) => void
    ? Exclude<TCommon, ReservedMetricLabelName>
    : never;

/**
 * Labels a caller may pass to a `PrometheusMetrics` scoped to `TKeys`: the names
 * every one of those metrics declares, minus the ones they set per observation.
 * With none left the set is empty, since `{}` skips excess-property checking.
 */
export type InstanceLabels<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TKeys extends keyof TMetricsDefinitions = keyof TMetricsDefinitions,
> = [CommonLabelNames<TMetricsDefinitions, TKeys>] extends [never]
    ? Record<string, never>
    : Readonly<Partial<Record<CommonLabelNames<TMetricsDefinitions, TKeys>, string>>>;

/**
 * Options for creating a `PrometheusMetrics` instance.
 *
 * Only `definitions` is required — the rest have sensible defaults.
 */
export interface PrometheusMetricsOptions<
    TMetricsDefinitions extends DefaultMetricDefinitions,
    TKeys extends keyof TMetricsDefinitions = keyof TMetricsDefinitions,
> {
    /** Metric instances (Counter / Histogram / Gauge) keyed by logical name. */
    definitions: TMetricsDefinitions;
    /** Whether to collect Node.js and process metrics. */
    collectProcessMetrics?: boolean;
    /** Optional pre-existing registry; a fresh one is created when omitted. */
    registry?: Registry;
}
