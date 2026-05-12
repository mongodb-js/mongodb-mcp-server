import type { IMetrics, MetricDefinitions, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

/**
 * A no-op metrics implementation that returns empty values.
 * Use this when you don't need metrics collection.
 *
 * @example
 * ```typescript
 * const runner = new StdioRunner({
 *   logger: compositeLogger,
 *   metrics: new NoopMetrics(),
 *   server: myServer,
 * });
 * await runner.start();
 * ```
 */
export class NoopMetrics<TMetrics extends MetricDefinitions = DefaultMetricDefinitions> implements IMetrics<TMetrics> {
    /** Returns undefined for any metric */
    get<K extends keyof TMetrics>(): TMetrics[K] {
        return undefined as TMetrics[K];
    }

    /** Returns an empty string for metrics output */
    getMetrics(): Promise<string> {
        return Promise.resolve("");
    }
}
