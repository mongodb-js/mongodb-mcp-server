export { PrometheusMetrics } from "./prometheusMetrics.js";
export { createDefaultMetrics } from "./metricDefinitions.js";
export type { DefaultMetrics } from "./metricDefinitions.js";
export type { Metrics, PrometheusMetricDefinitions, PrometheusMetricsOptions } from "./types.js";
export type { MetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";
export { Registry, Gauge, Histogram, Counter } from "prom-client";
