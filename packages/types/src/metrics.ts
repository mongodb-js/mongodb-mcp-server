export type MetricDefinitions = Record<string, unknown>;

export interface IObservable {
    observe(labels: Record<string, string>, value: number): void;
}

export interface IMetrics<TMetricsDefinitions extends MetricDefinitions = MetricDefinitions> {
    get<K extends keyof TMetricsDefinitions>(key: K): TMetricsDefinitions[K];
    getMetrics(): Promise<string>;
}

export type AnyMetrics = IMetrics;
