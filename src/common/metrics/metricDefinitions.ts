import type { Gauge } from "prom-client";
import { Counter, Histogram } from "prom-client";

/**
 * Helper type to extract label names from a Prometheus metric
 */
export type LabelNames<T> =
    T extends Histogram<infer L> ? L : T extends Counter<infer L> ? L : T extends Gauge<infer L> ? L : never;

/**
 * Helper type to create a record of label values
 */
export type Labels<T> = Record<LabelNames<T>, string>;

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
