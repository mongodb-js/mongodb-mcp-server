import { describe, it, expect } from "vitest";
import type { ICounter, IObservable, IMetrics, DefaultMetricDefinitions } from "@mongodb-js/mcp-types";
import { PrometheusMetrics, createDefaultMetrics, Counter, Histogram } from "./index.js";

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
        const counter = new Counter({ name: "test_counter", help: "test help" });

        const _counter: ICounter = counter;
        expect(_counter).toBeDefined();
        expect(typeof counter.inc).toBe("function");
    });

    it("prom-client Histogram should be assignable to IObservable", () => {
        const defaultMetrics = createDefaultMetrics();

        const _observable: IObservable = defaultMetrics.toolExecutionDuration;
        expect(_observable).toBeDefined();
        expect(typeof _observable.observe).toBe("function");
    });

    it("should be able to scope labels through the abstract interface", () => {
        const definitions = {
            ...createDefaultMetrics(),
            toolExecutionDuration: new Histogram({
                name: "mcp_tool_execution_duration_seconds",
                help: "test",
                labelNames: ["tool_name", "source"] as const,
                registers: [],
            }),
        };
        const metrics: IMetrics<DefaultMetricDefinitions> = new PrometheusMetrics({ definitions });

        const scoped = metrics.withLabels({ source: "vercel" });

        expect(scoped.labels).toEqual({ source: "vercel" });
        expect(scoped.get("toolExecutionDuration")).toBe(metrics.get("toolExecutionDuration"));
    });

    it("should be able to use metrics through the abstract interface", () => {
        const prometheusMetrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });
        const metrics: IMetrics<DefaultMetricDefinitions> = prometheusMetrics;

        const toolExecutionDuration = metrics.get("toolExecutionDuration");
        toolExecutionDuration.observe({ tool_name: "test" }, 0.1);

        expect(toolExecutionDuration).toBeDefined();
    });
});
