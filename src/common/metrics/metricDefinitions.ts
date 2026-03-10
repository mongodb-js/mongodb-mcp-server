import { Counter, Histogram } from "prom-client";

/** Default metrics for the MCP server. Imported as a value — do not construct these elsewhere,
 *  as prom-client's global registry rejects duplicate metric names. */
export const defaultMetrics = {
    toolExecutionDuration: new Histogram({
        name: "mcp_tool_execution_duration_ms",
        help: "Duration of tool executions in milliseconds",
        labelNames: ["tool_name", "category"] as const,
        buckets: [1, 5, 10, 50, 100, 500, 1000, 2500, 5000, 10000],
    }),
    toolExecutionTotal: new Counter({
        name: "mcp_tool_execution_total",
        help: "Total number of tool executions",
        labelNames: ["tool_name", "category", "status"] as const,
    }),
} as const;

export type DefaultMetrics = typeof defaultMetrics;
