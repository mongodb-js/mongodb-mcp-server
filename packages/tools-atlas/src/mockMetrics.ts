import { PrometheusMetrics, createDefaultMetrics, type DefaultMetrics } from "@mongodb-js/mcp-metrics";

export class MockMetrics extends PrometheusMetrics<DefaultMetrics> {
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}
