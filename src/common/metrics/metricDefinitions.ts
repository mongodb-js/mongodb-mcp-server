import { Counter, Histogram } from "prom-client";

/** Default metrics for the MCP server.
 *  NOTE: `registers: []` prevents prom-client from auto-registering these into the global registry; PrometheusMetrics registers them into its own isolated Registry instead. */
export const defaultMetrics = {
    toolExecutionDuration: new Histogram({
        name: "mcp_tool_execution_duration_ms",
        help: "Duration of tool executions in milliseconds",
        labelNames: ["tool_name", "category"] as const,
        buckets: [1, 5, 10, 50, 100, 500, 1000, 2500, 5000, 10000],
        registers: [],
    }),
    toolExecutionTotal: new Counter({
        name: "mcp_tool_execution_total",
        help: "Total number of tool executions",
        labelNames: ["tool_name", "category", "status"] as const,
        registers: [],
    }),
} as const;

export type DefaultMetrics = typeof defaultMetrics;
