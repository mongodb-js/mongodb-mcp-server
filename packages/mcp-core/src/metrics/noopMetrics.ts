import type { IMetrics, MetricDefinitions } from "@mongodb-js/mcp-api";

/**
 * A no-op stub returned by `NoopMetrics.get()`.
 *
 * Satisfies the `Histogram | Counter | Gauge` structural shape by absorbing
 * any method call without side-effects.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const NOOP_METRIC: any = new Proxy(
    {},
    {
        get() {
            // Return a function that itself returns the proxy so method chains work.
            return (): typeof NOOP_METRIC => NOOP_METRIC;
        },
    }
);

/**
 * A no-op `IMetrics` implementation used when the caller does not provide a
 * real metrics backend. All metric observations are silently discarded.
 */
export class NoopMetrics implements IMetrics {
    get<K extends keyof MetricDefinitions>(key: K): MetricDefinitions[K] {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return NOOP_METRIC as MetricDefinitions[K];
    }

    async getMetrics(): Promise<string> {
        return "";
    }
}
