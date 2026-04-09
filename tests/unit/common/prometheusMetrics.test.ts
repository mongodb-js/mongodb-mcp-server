import { describe, it, expect } from "vitest";
import { Registry, Counter } from "prom-client";
import { PrometheusMetrics } from "@mongodb-mcp/monitoring";

describe("PrometheusMetrics", () => {
    describe("collectProcessMetrics", () => {
        it("does not register process/nodejs metrics when collectProcessMetrics is false (default)", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: {}, registry });

            const output = await registry.metrics();
            expect(output).not.toMatch(/^# TYPE process_/m);
            expect(output).not.toMatch(/^# TYPE nodejs_/m);
        });

        it("registers process/nodejs metrics when collectProcessMetrics is true", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: {}, registry, collectProcessMetrics: true });

            const output = await registry.metrics();
            expect(output).toMatch(/^# TYPE process_/m);
        });

        it("registers nodejs_* metrics when collectProcessMetrics is true", () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: {}, registry, collectProcessMetrics: true });

            const metricNames = registry.getMetricsAsArray().map((m) => m.name);
            const hasNodejsMetric = metricNames.some((name) => name.startsWith("nodejs_"));
            expect(hasNodejsMetric).toBe(true);
        });
    });

    describe("custom metric definitions", () => {
        it("registers provided metrics in the registry", async () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            new PrometheusMetrics({ definitions: { myCounter: counter }, registry });

            const output = await registry.metrics();
            expect(output).toContain("my_counter_total");
        });

        it("get() returns the metric by key", () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            const metrics = new PrometheusMetrics({ definitions: { myCounter: counter }, registry });

            expect(metrics.get("myCounter")).toBe(counter);
        });
    });
});
