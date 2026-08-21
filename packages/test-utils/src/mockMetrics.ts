import {
    PrometheusMetrics,
    createDefaultMetrics,
    type DefaultPrometheusMetricDefinitions,
} from "@mongodb-js/mcp-metrics";
import type { IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";

export class MockMetrics
    extends PrometheusMetrics<DefaultPrometheusMetricDefinitions>
    implements IMetrics<DefaultMetricDefinitions>
{
    constructor() {
        super({ definitions: createDefaultMetrics() });
    }
}
