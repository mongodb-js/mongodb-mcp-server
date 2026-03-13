import { Counter, Histogram } from "prom-client";

/**
 * Creates a new set of default metrics for the MCP server.
 *
 * NOTE: `registers: []` prevents prom-client from auto-registering these into
 * the global registry; `PrometheusMetrics` registers them into its own
 * isolated `Registry` instead.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createDefaultMetrics() {
    return {
        toolExecutionDuration: new Histogram({
            name: "mcp_tool_execution_duration_seconds",
            help: "Duration of tool executions in seconds",
            labelNames: ["tool_name", "category"] as const,
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
            registers: [],
        }),
        toolExecutionTotal: new Counter({
            name: "mcp_tool_execution_total",
            help: "Total number of tool executions",
            labelNames: ["tool_name", "category", "status"] as const,
            registers: [],
        }),
    } as const;
}

export type DefaultMetrics = ReturnType<typeof createDefaultMetrics>;
