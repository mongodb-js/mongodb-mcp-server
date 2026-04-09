import { PrometheusMetrics, createDefaultMetrics, type DefaultMetrics } from "@mongodb-mcp/monitoring";

export class MockMetrics extends PrometheusMetrics<DefaultMetrics> {
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}
