import { Counter, Histogram } from "prom-client";

/** Returns the default metrics for the MCP server. */
// This is one of the cases where leaving it to the type system is better
// than explicitly typing the return type since we want it to be inferred
// from the returned complex object.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createDefaultMetrics() {
    return {
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
}

export type DefaultMetrics = ReturnType<typeof createDefaultMetrics>;
