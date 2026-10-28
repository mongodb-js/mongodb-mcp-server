import { describe, it, expect } from "vitest";
import { Registry, Counter, Histogram } from "prom-client";
import { PrometheusMetrics } from "./prometheusMetrics.js";
import { createDefaultMetrics } from "./metricDefinitions.js";

describe("PrometheusMetrics", () => {
    describe("collectProcessMetrics", () => {
        it("does not register process/nodejs metrics when collectProcessMetrics is false (default)", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry });

            const output = await registry.metrics();
            expect(output).not.toMatch(/^# TYPE process_/m);
            expect(output).not.toMatch(/^# TYPE nodejs_/m);
        });

        it("registers process/nodejs metrics when collectProcessMetrics is true", async () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry, collectProcessMetrics: true });

            const output = await registry.metrics();
            expect(output).toMatch(/^# TYPE process_/m);
        });

        it("registers nodejs_* metrics when collectProcessMetrics is true", () => {
            const registry = new Registry();
            new PrometheusMetrics({ definitions: createDefaultMetrics(), registry, collectProcessMetrics: true });

            const metricNames = registry.getMetricsAsArray().map((m) => m.name);
            const hasNodejsMetric = metricNames.some((name) => name.startsWith("nodejs_"));
            expect(hasNodejsMetric).toBe(true);
        });
    });

    describe("custom metric definitions", () => {
        it("registers provided metrics in the registry", async () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            new PrometheusMetrics({ definitions: { ...createDefaultMetrics(), myCounter: counter }, registry });

            const output = await registry.metrics();
            expect(output).toContain("my_counter_total");
        });

        it("get() returns the metric by key", () => {
            const registry = new Registry();
            const counter = new Counter({ name: "my_counter_total", help: "A test counter", registers: [] });
            const metrics = new PrometheusMetrics({
                definitions: { ...createDefaultMetrics(), myCounter: counter },
                registry,
            });

            expect(metrics.get("myCounter")).toBe(counter);
        });
    });

    describe("labels", () => {
        it("defaults to an empty, frozen record", () => {
            const metrics = new PrometheusMetrics({ definitions: createDefaultMetrics() });

            expect(metrics.labels).toEqual({});
            expect(Object.isFrozen(metrics.labels)).toBe(true);
        });

        it("exposes the labels passed at construction", () => {
            const metrics = new PrometheusMetrics({
                definitions: createDefaultMetrics(),
                labels: { tenant: "acme" },
            });

            expect(metrics.labels).toEqual({ tenant: "acme" });
        });

        it("withLabels() returns a sibling sharing definitions and registry", async () => {
            const registry = new Registry();
            const definitions = {
                ...createDefaultMetrics(),
                toolExecutionDuration: new Histogram({
                    name: "mcp_tool_execution_duration_seconds",
                    help: "test",
                    labelNames: ["tool_name", "tenant"] as const,
                    registers: [],
                }),
            };
            const base = new PrometheusMetrics<typeof definitions, "tenant">({ definitions, registry });
            const scoped = base.withLabels({ tenant: "acme" });

            expect(scoped.labels).toEqual({ tenant: "acme" });
            expect(scoped.registry).toBe(base.registry);
            expect(scoped.get("toolExecutionDuration")).toBe(base.get("toolExecutionDuration"));

            scoped.get("toolExecutionDuration").observe({ ...scoped.labels, tool_name: "find" }, 0.1);

            const output = await registry.metrics();
            expect(output).toContain('tenant="acme"');
            expect(output).toContain('tool_name="find"');
        });
    });
});
