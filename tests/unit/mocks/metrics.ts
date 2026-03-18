import { PrometheusMetrics } from "../../../src/common/metrics/prometheusMetrics.js";
import { createDefaultMetrics } from "../../../src/common/metrics/metricDefinitions.js";
import type { DefaultMetrics } from "../../../src/common/metrics/metricDefinitions.js";

export class MockMetrics extends PrometheusMetrics<DefaultMetrics> {
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}
