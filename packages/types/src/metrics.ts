export type MetricDefinitions = {
    [key: string]: unknown;
};

export interface IObservable {
    observe(labels: Record<string, string>, value: number): void;
}

export interface IMetrics<TMetrics extends MetricDefinitions = MetricDefinitions> {
    get<K extends keyof TMetrics>(key: K): TMetrics[K];
    getMetrics(): Promise<string>;
}
