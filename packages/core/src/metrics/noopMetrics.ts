import type { IMetrics, DefaultMetricDefinitions, ICounter, IObservable, IGauge } from "@mongodb-js/mcp-types";

/**
 * Combined no-op metric object that implements all metric interfaces.
 * Has all possible methods so it works for any metric type.
 */
const noopMetric: ICounter & IObservable & IGauge = {
    inc: () => {},
    observe: () => {},
    set: () => {},
    dec: () => {},
};

/**
 * A no-op metrics implementation that returns empty values.
 * Use this when you don't need metrics collection.
 *
 * @example
 * ```typescript
 * class MyStdioRunner extends StdioRunner {
 *   protected override async createServer(): Promise<McpServer> {
 *     return myServer;
 *   }
 * }
 * const runner = new MyStdioRunner({ logger: compositeLogger });
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
