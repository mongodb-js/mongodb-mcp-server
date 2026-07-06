import { PrometheusMetrics, createDefaultMetrics } from "@mongodb-js/mcp-metrics";
import type { DefaultMetricDefinitions, IMetrics } from "@mongodb-js/mcp-types";

export class MockMetrics
    extends PrometheusMetrics<DefaultMetricDefinitions>
    implements IMetrics<DefaultMetricDefinitions>
{
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}
