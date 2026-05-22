import type { IMetrics, DefaultMetricDefinitions, ICounter, IObservable } from "@mongodb-js/mcp-types";

/**
 * Combined no-op metric object that implements all metric interfaces.
 * Has all possible methods so it works for any metric type.
 */
const noopMetric: ICounter & IObservable = {
    inc: () => {},
    observe: () => {},
};

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
export class NoopMetrics implements IMetrics<DefaultMetricDefinitions> {
    /** Returns a no-op metric for any key */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    get<K extends keyof DefaultMetricDefinitions>(_key: K): DefaultMetricDefinitions[K] {
        return noopMetric;
    }

    /** Returns an empty string for metrics output */
    getMetrics(): Promise<string> {
        return Promise.resolve("");
    }
}
