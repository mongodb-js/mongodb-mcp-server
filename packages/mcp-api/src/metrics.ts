/**
 * Re-export of the public metric type definitions from `@mongodb-js/mcp-metrics`.
 *
 * Other mcp-* packages should depend on `mcp-api` for their metric type
 * surface so they don't have to take a direct dependency on the prom-client
 * implementation package.
 */
export type { MetricDefinitions, Metrics, PrometheusMetricsOptions } from "@mongodb-js/mcp-metrics";

/**
 * Re-named alias matching the rest of the `I*` interface naming scheme used
 * inside `mcp-api`.
 */
export type { Metrics as IMetrics } from "@mongodb-js/mcp-metrics";
