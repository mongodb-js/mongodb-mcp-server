import { describe, it, expect } from "vitest";
import type { ICounter, IObservable, IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { PrometheusMetrics, createDefaultMetrics } from "./index.js";

/**
 * Type compatibility test for metrics interfaces.
 * This verifies that PrometheusMetrics<DefaultPrometheusMetricDefinitions> can be assigned to
 * IMetrics<DefaultMetricDefinitions> without requiring type assertions.
 */
describe("metrics type compatibility", () => {
    it("PrometheusMetrics<DefaultPrometheusMetricDefinitions> should be assignable to IMetrics<DefaultMetricDefinitions>", () => {
        const prometheusMetrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

        const metrics: IMetrics<DefaultMetricDefinitions> = prometheusMetrics;
        expect(metrics).toBe(prometheusMetrics);
    });

    it("prom-client Counter should be assignable to ICounter", () => {
        const defaultMetrics = createDefaultMetrics();

        const _counter: ICounter = defaultMetrics.sessionCreated;
        expect(_counter).toBeDefined();
        expect(typeof defaultMetrics.sessionCreated.inc).toBe("function");
    });

    it("prom-client Histogram should be assignable to IObservable", () => {
        const defaultMetrics = createDefaultMetrics();

        const _observable: IObservable = defaultMetrics.toolExecutionDuration;
        expect(_observable).toBeDefined();
        expect(typeof _observable.observe).toBe("function");
    });

    it("should be able to use metrics through the abstract interface", () => {
        const prometheusMetrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const metrics: IMetrics<DefaultMetricDefinitions> = prometheusMetrics;

        const sessionCreated = metrics.get("sessionCreated");
        sessionCreated.inc();

        const toolExecutionDuration = metrics.get("toolExecutionDuration");
        toolExecutionDuration.observe({ tool_name: "test" }, 0.1);

        expect(sessionCreated).toBeDefined();
        expect(toolExecutionDuration).toBeDefined();
    });
});
